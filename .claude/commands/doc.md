操作飞书云文档：搜索、读取或创建。

## 参数
- $ARGUMENTS：操作类型 + 文档标识或内容

## 执行步骤

### 搜索文档
1. 用 `search_docs` 搜索关键词
2. 展示文档列表（标题、链接）

### 读取文档
1. 用 `read_doc` 读取文档内容（传入 document_id）
2. 展示内容摘要

### 创建文档
1. 用 `create_doc` 创建新文档（传入标题和可选文件夹）
2. 返回文档链接

## 示例
- `/doc search MCP 协议`
- `/doc read doxcnXXXXXX`
- `/doc create 本周工作总结`
