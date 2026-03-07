操作飞书多维表格（Bitable）。

## 参数
- $ARGUMENTS：操作类型 + 表格标识

## 执行步骤

### 查询数据
1. 用 `list_bitable_tables` 获取表格列表
2. 用 `list_bitable_fields` 获取字段结构
3. 用 `search_bitable_records` 查询记录（支持 filter 和 sort）
4. 格式化展示查询结果

### 写入数据
1. 确认目标表格和字段结构
2. 用 `create_bitable_record` 创建新记录

### 更新数据
1. 先查询定位到目标记录
2. 用 `update_bitable_record` 更新

## 示例
- `/table query appXxx tableXxx`
- `/table create appXxx tableXxx {"状态":"进行中","标题":"新任务"}`
