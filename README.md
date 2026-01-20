# 羽毛球比赛计分系统（4队大循环 / 每场7局 / 实时看板）

## 功能
- 观众页：实时显示积分榜、赛程与逐局胜负（进行中置顶）
- 裁判页：登录后生成赛程、开始/结束比赛、逐局点胜方
  - 手机友好：进入单场计分、大按钮
  - 撤销本局 / 重置本场
- 导出：
  - CSV（UTF-8 BOM，Excel 不乱码）：/api/export.csv（需裁判登录）
  - PNG 战报：裁判页一键生成下载

## 裁判账号
修改 server/config.local.json
默认：
- username: ref
- password: 123456

## 本地运行
```bash
npm install
npm start
# 观众页：http://localhost:3000/
# 裁判页：http://localhost:3000/referee
