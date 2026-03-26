const fs = require('fs');
const path = require('path');

const SERVER_NAMES = ['feishu-user-plugin', 'feishu'];

/**
 * Search an mcpServers object for a feishu-user-plugin entry.
 * Returns { serverName, serverEnv } or null.
 */
function _findInServers(servers) {
  if (!servers || typeof servers !== 'object') return null;
  for (const name of SERVER_NAMES) {
    if (servers[name]?.env) {
      return { serverName: name, serverEnv: servers[name].env };
    }
  }
  return null;
}

/**
 * Discover the MCP config file containing feishu-user-plugin server entry.
 *
 * Search order:
 *   1. ~/.claude.json — top-level mcpServers
 *   2. ~/.claude.json — projects[*].mcpServers (Claude Code project-level config)
 *   3. ~/.claude/.claude.json — same two-level search
 *   4. <cwd>/.mcp.json — top-level mcpServers (reliable in CLI mode)
 *
 * Returns { configPath, config, serverName, serverEnv, projectPath? } or null.
 */
function findMcpConfig() {
  const candidates = [
    path.join(process.env.HOME || '', '.claude.json'),
    path.join(process.env.HOME || '', '.claude', '.claude.json'),
    path.join(process.cwd(), '.mcp.json'),
  ];

  for (const configPath of candidates) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw);

      // Strategy 1: top-level mcpServers
      const topLevel = _findInServers(config.mcpServers);
      if (topLevel) {
        return { configPath, config, ...topLevel, projectPath: null };
      }

      // Strategy 2: projects[*].mcpServers (Claude Code nests project-level config here)
      if (config.projects) {
        for (const [projPath, projConfig] of Object.entries(config.projects)) {
          const nested = _findInServers(projConfig.mcpServers);
          if (nested) {
            return { configPath, config, ...nested, projectPath: projPath };
          }
        }
      }

      // Strategy 3: .mcp.json uses top-level keys as server names (no mcpServers wrapper)
      const bare = _findInServers(config);
      if (bare) {
        return { configPath, config, ...bare, projectPath: null };
      }
    } catch {}
  }
  return null;
}

/**
 * Read all LARK_* credentials from the discovered MCP config.
 * Returns an object with all env vars, or {} if no config found.
 */
function readCredentials() {
  const found = findMcpConfig();
  if (!found) return {};
  return { ...found.serverEnv };
}

/**
 * Persist key-value updates into the MCP config's env block.
 * Uses findMcpConfig() to locate the correct entry, then writes back.
 * Returns true if persisted successfully, false otherwise.
 */
function persistToConfig(updates) {
  try {
    const found = findMcpConfig();
    if (!found) {
      console.error('[feishu-user-plugin] WARNING: No MCP config found. Update your config manually.');
      return false;
    }

    const { configPath, config, serverName, projectPath } = found;

    // Navigate to the correct env object
    let env;
    if (projectPath) {
      env = config.projects[projectPath].mcpServers[serverName].env;
    } else if (config.mcpServers?.[serverName]) {
      env = config.mcpServers[serverName].env;
    } else {
      env = config[serverName].env;
    }

    Object.assign(env, updates);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.error(`[feishu-user-plugin] Config persisted to ${configPath}${projectPath ? ` (project: ${projectPath})` : ''}`);
    return true;
  } catch (e) {
    console.error(`[feishu-user-plugin] Failed to persist config: ${e.message}`);
    return false;
  }
}

/**
 * Write a complete feishu-user-plugin MCP server entry to a config file.
 * Used by the setup wizard.
 *
 * If an existing config is found via findMcpConfig(), updates it in-place
 * (preserving its location — top-level or project-level).
 * Otherwise, writes to ~/.claude.json top-level mcpServers.
 *
 * @param {object} env - The env vars to write
 * @param {string} [configPath] - Override the target config file path
 * @param {string} [projectPath] - If writing to a project-level entry
 * @returns {{ configPath: string }} The path that was written
 */
function writeNewConfig(env, configPath, projectPath) {
  if (!configPath) {
    configPath = path.join(process.env.HOME || '', '.claude.json');
  }

  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {}

  const serverEntry = {
    command: 'npx',
    args: ['-y', 'feishu-user-plugin'],
    env,
  };

  if (projectPath && config.projects?.[projectPath]) {
    // Write into existing project-level config
    if (!config.projects[projectPath].mcpServers) config.projects[projectPath].mcpServers = {};
    config.projects[projectPath].mcpServers['feishu-user-plugin'] = serverEntry;
    if (config.projects[projectPath].mcpServers.feishu) {
      delete config.projects[projectPath].mcpServers.feishu;
    }
  } else if (configPath.endsWith('.mcp.json') && !config.mcpServers) {
    // Bare .mcp.json format: server entries at top level (no mcpServers wrapper)
    config['feishu-user-plugin'] = serverEntry;
    if (config.feishu) {
      delete config.feishu;
    }
  } else {
    // Write to top-level mcpServers (default for ~/.claude.json)
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers['feishu-user-plugin'] = serverEntry;
    if (config.mcpServers.feishu) {
      delete config.mcpServers.feishu;
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return { configPath };
}

module.exports = { findMcpConfig, readCredentials, persistToConfig, writeNewConfig, SERVER_NAMES };
