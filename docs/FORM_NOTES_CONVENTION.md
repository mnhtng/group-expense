# Quy ước ghi chú cho form tài chính

**Phạm vi:** chỉ những form liên quan trực tiếp đến **hóa đơn, công nợ, thanh toán/hoàn trả**.

## Quy tắc

- Trường ghi chú là **không bắt buộc**. Bỏ trống không cản trở thao tác.
- Áp dụng cho: tạo/sửa hóa đơn, xóa hóa đơn, tạo yêu cầu thanh toán công nợ (một hoặc nhiều khoản), xác nhận, từ chối và hủy yêu cầu thanh toán.
- Trường ghi chú gắn với chứng từ hoặc sự kiện tài chính chính xác: hóa đơn lưu `expenses.notes`; xóa hóa đơn lưu `expense_events.snapshot.note`; yêu cầu hoàn trả lưu `settlements.note`; xác nhận/từ chối/hủy lưu `settlement_events.note`.
- Ghi chú thanh toán: tối đa **500 ký tự** (theo schema hiện hữu); ghi chú hóa đơn: **1000 ký tự**.
- Ghi chú được trim/validate **trên server**, lưu bằng SQL tham số hóa và hiển thị dưới dạng text, không dùng HTML tùy ý.
- Dùng `OptionalNoteField` trong confirmation tài chính khi phù hợp. Vẫn giữ UI gọn, ưu tiên mobile.
- Không xóa hoặc ghi đè audit cũ của thao tác đã xác nhận.

## Không thêm ghi chú vào các form khác

**Không có note field** trong: tạo nhóm, sửa tên nhóm, lưu trữ nhóm, tạo link mời/QR, chấp nhận lời mời, rời nhóm, chuyển chủ nhóm, xóa thành viên, đăng ký/đăng nhập, hồ sơ, tìm kiếm, cấp quyền thông báo và các biểu mẫu không liên quan đến hóa đơn/công nợ/thanh toán.

Khi tạo form mới, chỉ thêm trường ghi chú nếu nó là thao tác nghiệp vụ tài chính thuộc phạm vi trên; không mặc định chèn ghi chú vào mọi form.

## Tương thích database

Migration **`008_optional_notes.sql` đã được áp dụng trên database development**. Vì migration đã có checksum và có thể đã chứa ghi chú lịch sử, **không xóa, đổi nội dung hay DROP các cột/bảng do migration đó tạo ra** trong đợt chỉnh sửa giao diện này. Chúng sẽ không còn được sử dụng bởi giao diện, API hoặc nhóm nghiệp vụ phi tài chính; dữ liệu cũ vẫn được bảo toàn. Nếu muốn dọn schema sau này, cần quyết định riêng về lưu trữ/export, backup và migration không phá hủy dữ liệu.

## Acceptance

1. Có ô "Ghi chú (không bắt buộc)" ở mọi form tài chính đang hỗ trợ ghi chú.
2. Không có ô ghi chú ở các form ngoài tài chính.
3. Ghi chú tài chính được lưu và đọc lại trong đúng hóa đơn/sự kiện.
4. Dữ liệu ghi chú cũ ngoài tài chính không bị xóa.
5. CI, SQL integration tests, build và preview deployment thành công.
