搜索和管理飞书知识库。

## 参数
- $ARGUMENTS：操作类型 + 关键词或节点标识

## 执行步骤

### 列出空间
1. 用 `list_wiki_spaces` 列出所有可访问的知识库空间

### 搜索内容
1. 用 `search_wiki` 搜索知识库节点
2. 找到节点后可用 `read_doc` 读取其文档内容

### 浏览节点
1. 用 `list_wiki_nodes` 列出指定空间的节点树

## 示例
- `/wiki list`
- `/wiki search MCP 协议`
