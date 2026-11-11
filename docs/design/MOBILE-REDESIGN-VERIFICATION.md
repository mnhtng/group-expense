# Kiểm tra giao diện điện thoại

Hoàn tất: 2026-11-11 (Asia/Ho_Chi_Minh). Nhánh: `feat/mobile-design-system`. Nền: main `3d786493c50a503d58f31e768976a5800b774f8e`.

## Phạm vi

Thiết kế lại thành phần giao diện và cách chia màn; không đổi API, schema, phép tính chia tiền, phân quyền hay quy tắc quyết toán. Không triển khai lên staging/production trong đợt này.

## Kết quả

- 182 unit tests: PASS.
- ESLint: PASS.
- TypeScript và production build Next.js 16.4.3: PASS.
- Chromium local: 24 lượt ở 320 / 390 / 430 / 1440px cho nhóm, trong nhóm, công nợ, quản lý, thêm khoản và kỳ quyết toán. Không tràn ngang, body 17px, không có console/page error. Ảnh đã đọc lại trực tiếp.
- HTTP: PASS cả hồ sơ auth/ledger đầy đủ và hồ sơ SC025 với gate thật, không dùng bypass tài chính.
- Bốn browser: PASS Chromium desktop, WebKit desktop, iPhone mô phỏng, Android mô phỏng. Có kiểm tra 320px trong luồng khoản chi.
- Tám đối soát tài chính độc lập sau HTTP: không có vi phạm. Browser tiếp tục kiểm tra bảo toàn nợ gốc, NONCASH và CASH được người kia xác nhận.
- Runtime local dùng LOGIN riêng không sở hữu bảng; kiểm tra quyền trước/sau PASS. Database giả lập được xóa khi script kết thúc.
- Hai màn auth của production build local: PASS kiểm tra overflow/console và đã xem ảnh trực tiếp.
- `git diff --check`: PASS.

Bộ kiểm chứng hoàn tất lúc `2026-11-10T17:05:34.547Z` (00:05:34 ngày 11/11 theo giờ Việt Nam). Code digest bao gồm source và tests: `204eae7316fa0a23e028d142bdad76a1cdebbccea68fccec0015d5c7a530db06`. HEAD lúc chạy vẫn là commit nền; digest nhận diện chính xác working tree đã kiểm tra. Tài liệu không tham gia digest.

Lệnh dùng lại (Node 22, Docker local và Playwright đã có):

```sh
pnpm lint
pnpm test:unit
RR002_PLAYWRIGHT_ENTRY=/absolute/path/to/playwright/index.mjs bash scripts/rr004-runtime-local.sh
```

Script cuối tự tạo PostgreSQL 17 local, migration hai lần, provision role giới hạn, build, chạy HTTP, audit, bốn browser và đối chiếu source digest trước/sau. Không dùng kết nối Neon cho script này.

Ảnh và kết quả máy đọc nằm trong thư mục local được gitignore `rr003-artifacts/2026-11-10-mobile/`. Chỉ có dữ liệu giả lập; cookie/phiên đăng nhập không được đưa vào repository.

## Luồng nghiệm thu

- Tạo nhóm từ màn riêng qua request thật và phiên Better Auth thật.
- Thêm khoản chi hai bước; quay lại vẫn giữ tên, ghi chú, món và số tiền.
- Kiểm tra tổng phần chia 100001 đồng qua UI → API → PostgreSQL, không làm tròn mất tiền lẻ.
- Giữ các kiểm tra cũ về quyền người tạo, phiên đăng nhập, phân trang hơn 50 khoản, tổng toàn kỳ, lỗi mạng/thử lại và riêng tư giữa hai bên.
- Giữ xác nhận độc lập, dữ liệu stale bị từ chối, focus/keyboard, bù nợ hai chiều, yêu cầu CASH và xác nhận của người kia.

## Giới hạn

Chưa nghiệm thu thiết bị thật hoặc PWA đã cài. Bản redesign local này chưa thay giao diện website đang chạy. Các gate phát hành và kích hoạt nhóm thật trong release-readiness vẫn giữ nguyên trạng thái của lần phát hành trước.
