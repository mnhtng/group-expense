# Quy ước ghi chú cho mọi form nghiệp vụ

**Áp dụng:** mọi luồng nhập liệu nhằm tạo/sửa/xóa một bản ghi hoặc thực hiện thay đổi nghiệp vụ trong Group Expense PWA. Không dùng ORM.

## Yêu cầu bắt buộc

- Mọi form nghiệp vụ phải có trường **Ghi chú (không bắt buộc)**. Khi form là một confirmation inline, hiển thị trường này bên trong vùng xác nhận.
- Lưu được cả khi người dùng để trống; không tự thêm giá trị giả/placeholder vào database. Với dữ liệu nhập, trim khoảng trắng; trống -> `NULL`.
- Giới hạn chuẩn **1000 ký tự**; riêng settlement có giới hạn sẵn **500 ký tự** để tương thích schema. Kiểm tra ở UI **và** server. Không tin dữ liệu client gửi lên.
- Dùng `OptionalNoteField` để giao diện thống nhất: textarea tối thiểu 2 dòng, màn mobile dễ bấm, không tự đóng khi tương tác.
- Ghi chú của bản ghi có thể sửa -> lưu trực tiếp trong bản ghi tương ứng; ghi chú của thao tác đã xảy ra -> lưu audit/event append-only, không ghi đè các sự kiện trước.
- Ghi chú cần xuất hiện lại tại màn chi tiết hoặc lịch sử có phân quyền; render như text (React escaped), không dùng `dangerouslySetInnerHTML`.
- Không thay thế ghi chú gốc của hóa đơn/settlement bằng ghi chú của một lần thao tác. Các đối tượng có nhiều phiên bản ghi chú phải giữ nguồn/actor/thời gian.
- Không cho phép truy vấn ghi chú ngoài phạm vi nhóm hoặc user được ủy quyền.

## Các form hiện hữu

| Form | Nơi lưu |
|---|---|
| Tạo nhóm | `groups.notes` + `group_note_events` |
| Đổi tên / thông tin nhóm | `groups.notes` + `group_note_events` |
| Lưu trữ nhóm | `group_note_events` |
| Tạo link mời / QR | `group_invites.notes` + `group_note_events` |
| Chấp nhận lời mời | `group_note_events` |
| Rời nhóm / xóa thành viên / chuyển chủ nhóm | `group_membership_events.details.note` |
| Tạo / sửa hóa đơn | `expenses.notes` (đã hỗ trợ trước đó) |
| Xóa hóa đơn | `expense_events.snapshot.note` |
| Tạo yêu cầu thanh toán (một hoặc nhiều công nợ) | `settlements.note` và `settlement_events.note` |
| Xác nhận / từ chối / hủy yêu cầu thanh toán | `settlement_events.note` |

**Ngoại lệ có chủ ý:** Đăng nhập, đăng ký, đổi mật khẩu, cấp quyền thông báo và các điều khiển thuần giao diện không được coi là form nghiệp vụ có đối tượng ghi chú. Không lưu ghi chú trong quá trình xác thực, tránh thu thập thông tin không cần thiết và xung đột với Better Auth.

## Acceptance checklist cho form mới

1. Giao diện có ô ghi chú không bắt buộc, không làm nút lưu bị vô hiệu khi để trống.
2. API/Server Action nhận và validate ghi chú; SQL parameterized query lưu đúng nơi.
3. Mở lại trang chi tiết/lịch sử có thể đọc ghi chú của đúng đối tượng.
4. Ghi chú dài, không có ghi chú, emoji, tiếng Việt, xuống dòng và XSS payload được xử lý an toàn.
5. Tất cả tests, typecheck, build, DB migrations và test trên mobile đều phải pass.
