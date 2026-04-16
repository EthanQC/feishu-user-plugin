const fs = require('fs');
const path = require('path');

const SERVER_NAMES = ['feishu-user-plugin', 'feishu'];

// --- Atomic file write ---
// Writes to a tmp file then renames, preventing partial reads / race conditions
// with Claude Code (which also reads/writes ~/.claude.json).
function _atomicWrite(filePath, content) {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

// --- Minimal TOML helpers (only handles MCP server config structure) ---

function _tomlEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Read key="value" pairs from a TOML section.
 * Returns { key: value } or null if section not found.
 */
function _readTomlSection(content, sectionPath) {
  const header = `[${sectionPath}]`;
  const idx = content.indexOf(header);
  if (idx === -1) return null;

  const afterHeader = content.slice(idx + header.length);
  const nextSection = afterHeader.search(/^\[/m);
  const sectionBody = nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection);

  const result = {};
  for (const line of sectionBody.split('\n')) {
    // String value: key = "value"
    const strMatch = line.match(/^(\w+)\s*=\s*"(.*)"/);
    if (strMatch) { result[strMatch[1]] = strMatch[2]; continue; }
    // Array value: key = ["a", "b"]
    const arrMatch = line.match(/^(\w+)\s*=\s*\[(.*)\]/);
    if (arrMatch) {
      result[arrMatch[1]] = arrMatch[2].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    }
  }
  return result;
}

/**
 * Update or append key-value pairs in a TOML section.
 * Creates the section if it doesn't exist.
 */
function _updateTomlSection(content, sectionPath, updates) {
  const header = `[${sectionPath}]`;
  const idx = content.indexOf(header);

  if (idx === -1) {
    // Append new section
    let block = '\n' + header + '\n';
    for (const [k, v] of Object.entries(updates)) {
      block += `${k} = "${_tomlEscape(v)}"\n`;
    }
    return content.trimEnd() + '\n' + block;
  }

  // Find section boundaries
  const afterHeader = idx + header.length;
  const rest = content.slice(afterHeader);
  const nextSection = rest.search(/^\[/m);
  const sectionEnd = nextSection === -1 ? content.length : afterHeader + nextSection;
  let sectionBody = content.slice(afterHeader, sectionEnd);

  for (const [k, v] of Object.entries(updates)) {
    const escaped = _tomlEscape(v);
    const keyRegex = new RegExp(`^${k}\\s*=\\s*".*"`, 'm');
    if (keyRegex.test(sectionBody)) {
      sectionBody = sectionBody.replace(keyRegex, `${k} = "${escaped}"`);
    } else {
      sectionBody = sectionBody.trimEnd() + `\n${k} = "${escaped}"\n`;
    }
  }

  return content.slice(0, afterHeader) + sectionBody + content.slice(sectionEnd);
}

/**
 * Generate a complete TOML MCP server entry.
 */
function _generateTomlServerEntry(serverName, env) {
  const section = `mcp_servers.${serverName}`;
  // Codex uses Content-Length framing; our server uses newline-delimited JSON.
  // The bridge script translates between the two automatically.
  // Resolve bridge path: prefer local repo, fall back to npx-installed package.
  const localBridge = path.join(__dirname, '..', 'scripts', 'mcp_stdio_bridge.js');
  let block = `[${section}]\n`;
  block += `command = "node"\n`;
  block += `args = ["${_tomlEscape(localBridge)}"]\n\n`;
  block += `[${section}.env]\n`;
  for (const [k, v] of Object.entries(env)) {
    block += `${k} = "${_tomlEscape(v)}"\n`;
  }
  return block;
}

/**
 * Remove all TOML sections matching a server name.
 */
function _removeTomlServer(content, serverName) {
  // Remove [mcp_servers.<name>] and [mcp_servers.<name>.*] sections
  const pattern = new RegExp(
    `\\[mcp_servers\\.${serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\]]*\\][^\\[]*`,
    'g'
  );
  return content.replace(pattern, '');
}

// --- JSON config helpers ---

/**
 * Search an mcpServers object for a feishu-user-plugin entry.
 * Returns { serverName, serverEnv } or null.
 */
function _findInServers(servers) {
  if (!servers || typeof servers !== 'object') return null;
  for (const name of SERVER_NAMES) {
    if (servers[name]) {
      if (!servers[name].env) servers[name].env = {};
      return { serverName: name, serverEnv: servers[name].env };
    }
  }
  return null;
}

/**
 * Discover the MCP config file containing feishu-user-plugin server entry.
 *
 * Search order:
 *   1. ~/.claude.json — top-level mcpServers (Claude Code)
 *   2. ~/.claude.json — projects[*].mcpServers (Claude Code project-level)
 *   3. ~/.claude/.claude.json — same two-level search
 *   4. <cwd>/.mcp.json — top-level mcpServers
 *   5. ~/.codex/config.toml — Codex MCP config
 *
 * Returns { configPath, config, serverName, serverEnv, projectPath? } or null.
 */
function findMcpConfig() {
  const home = process.env.HOME;

  // --- JSON candidates ---
  const jsonCandidates = [
    ...(home ? [
      path.join(home, '.claude.json'),
      path.join(home, '.claude', '.claude.json'),
    ] : []),
    path.join(process.cwd(), '.mcp.json'),
  ];

  for (const configPath of jsonCandidates) {
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
    } catch (e) {
      // Only warn if the file exists but is invalid (not for missing files)
      if (e.code !== 'ENOENT') {
        console.error(`[feishu-user-plugin] Warning: Failed to parse ${configPath}: ${e.message}`);
      }
    }
  }

  // --- Codex TOML ---
  if (home) {
    const codexConfig = path.join(home, '.codex', 'config.toml');
    try {
      const raw = fs.readFileSync(codexConfig, 'utf8');
      for (const name of SERVER_NAMES) {
        const env = _readTomlSection(raw, `mcp_servers.${name}.env`);
        if (env) {
          return { configPath: codexConfig, config: null, serverName: name, serverEnv: env, projectPath: null };
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`[feishu-user-plugin] Warning: Failed to parse ${codexConfig}: ${e.message}`);
      }
    }
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
 * Uses findMcpConfig() to locate the correct entry, then writes back atomically.
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

    // --- TOML path ---
    if (configPath.endsWith('.toml')) {
      let content = '';
      try { content = fs.readFileSync(configPath, 'utf8'); } catch {}
      content = _updateTomlSection(content, `mcp_servers.${serverName}.env`, updates);
      _atomicWrite(configPath, content);
      console.error(`[feishu-user-plugin] Config persisted to ${configPath}`);
      return true;
    }

    // --- JSON path ---
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
    _atomicWrite(configPath, JSON.stringify(config, null, 2) + '\n');
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
 * @param {object} env - The env vars to write
 * @param {object} [options] - { configPath, projectPath, client }
 *   client: 'claude' (default) | 'codex' | 'both'
 * @returns {{ configPath: string, codexConfigPath?: string }}
 */
function writeNewConfig(env, configPath, projectPath, client) {
  const results = {};

  // --- Claude Code (JSON) ---
  if (client !== 'codex') {
    results.configPath = _writeClaudeConfig(env, configPath, projectPath);
  }

  // --- Codex (TOML) ---
  if (client === 'codex' || client === 'both') {
    results.codexConfigPath = _writeCodexConfig(env);
  }

  return results;
}

function _writeClaudeConfig(env, configPath, projectPath) {
  if (!configPath) {
    configPath = path.join(process.env.HOME || '', '.claude.json');
  }

  if (projectPath) {
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    if (!existing.projects?.[projectPath]) {
      console.error(`[feishu-user-plugin] Warning: project entry "${projectPath}" not found in ${configPath}, writing to top-level mcpServers`);
      projectPath = null;
    }
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
    if (!config.projects[projectPath].mcpServers) config.projects[projectPath].mcpServers = {};
    config.projects[projectPath].mcpServers['feishu-user-plugin'] = serverEntry;
    if (config.projects[projectPath].mcpServers.feishu) {
      delete config.projects[projectPath].mcpServers.feishu;
    }
  } else if (configPath.endsWith('.mcp.json') && !config.mcpServers) {
    config['feishu-user-plugin'] = serverEntry;
    if (config.feishu) delete config.feishu;
  } else {
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers['feishu-user-plugin'] = serverEntry;
    if (config.mcpServers.feishu) delete config.mcpServers.feishu;
  }

  _atomicWrite(configPath, JSON.stringify(config, null, 2) + '\n');
  return configPath;
}

function _writeCodexConfig(env) {
  const home = process.env.HOME || '';
  const codexDir = path.join(home, '.codex');
  const configPath = path.join(codexDir, 'config.toml');

  // Ensure ~/.codex/ exists
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  let content = '';
  try { content = fs.readFileSync(configPath, 'utf8'); } catch {}

  // Remove existing feishu entries
  for (const name of SERVER_NAMES) {
    content = _removeTomlServer(content, name);
  }

  // Append new entry
  content = content.trimEnd() + '\n\n' + _generateTomlServerEntry('feishu-user-plugin', env);

  _atomicWrite(configPath, content);
  console.error(`[feishu-user-plugin] Codex config written to ${configPath}`);
  return configPath;
}

module.exports = { findMcpConfig, readCredentials, persistToConfig, writeNewConfig, SERVER_NAMES };
