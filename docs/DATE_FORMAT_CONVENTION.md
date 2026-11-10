# Quy ước ngày tháng trên Group Expense PWA

Tất cả **ngày hiển thị và nhập liệu** trên web dùng thứ tự **ngày/tháng/năm: d/m/yyyy**.
Ví dụ: `4/11/2026` (không ép số 0 phía trước ngày/tháng).
Ngày kèm giờ dùng `4/11/2026 07:05` (24 giờ, múi giờ `Asia/Ho_Chi_Minh`).

## Phân biệt hiển thị và lưu trữ

- **UI:** ngày `d/m/yyyy`; ngày giờ `d/m/yyyy HH:mm`.
- **API/DB:** giữ date-only `YYYY-MM-DD` và timestamp ISO 8601/UTC, không thay đổi schema hoặc migration vì mục tiêu hiển thị.
- Dùng `formatDateDMY`, `formatDateTimeDMY`, `parseDateDMY`, `todayVietnamISO` trong `lib/date-format.ts`.
- Không dùng `new Date("YYYY-MM-DD").toLocaleDateString(...)` để hiển thị ngày chi tiêu: có thể lệch ngày do timezone.
- Không tự dùng `toLocaleDateString()` hoặc `toLocaleString()` cho ngày trong UI; luôn gọi helper tập trung để nhất quán.
- Thành phần nhập ngày dùng `DateDMYInput`: nhập trực tiếp d/m/yyyy hoặc dùng lịch native. Chỉ ngày ISO hợp lệ mới gửi vào API.
- Kiểm tra ngày nhuận, ngày không tồn tại và đầu/cuối ngày theo múi giờ Việt Nam.
- Khi thêm màn hình, bộ lọc ngày hoặc form mới, dùng đúng helper và bổ sung regression tests.

## Ví dụ

| Dữ liệu gốc | Hiển thị |
|---|---|
| `2026-11-04` | `4/11/2026` |
| `2024-02-29` | `29/2/2024` |
| `2026-11-03T18:30:00.000Z` | `4/11/2026 01:30` |

Đã áp dụng trong các màn hình nhóm, hóa đơn, công nợ, thanh toán và thông báo.
