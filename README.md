# Court Kicks Basketball Shoe Rental

完整篮球鞋租赁演示项目：React 前端、Express 后端、SQLite 数据库文件持久化。

已包含 AR 试穿 v1：用户可以上传/拍摄脚部照片，或打开摄像头视频，把仓库鞋款叠加到脚上，手动拖动、缩放、旋转后保存试穿图。

## Run

```bash
npm install
npm run dev
```

- Frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:4000/api`

打开首页后点击顶部 `AR 试穿`，或在鞋款卡片上点击星光图标进入指定鞋款试穿。

## Demo Accounts

- User: `user@court.local` / `user123`
- Admin: `admin@court.local` / `admin123`

## Scripts

```bash
npm run server
npm run client
npm run build
npm test
```

The SQLite database is created at `server/data/rental.sqlite` on first server start.
