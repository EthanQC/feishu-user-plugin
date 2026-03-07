搜索飞书联系人或群组。

## 参数
- $ARGUMENTS: 搜索关键词

## 执行步骤
1. 使用 `search_contacts` 搜索 $ARGUMENTS
2. 将结果按类型分组展示：
   - 用户（user）：显示名称和 ID
   - 群组（group）：显示群名和 ID
3. 提示用户可以使用 /send 直接发消息给搜索到的联系人
