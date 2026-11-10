# GroupExpense — giao diện dùng trên điện thoại

## Mục tiêu

Lấy cách tổ chức của Tricount làm tham chiếu: mở nhóm, xem khoản chi hoặc công nợ, rồi làm một việc. Chữ lớn, danh sách rõ, câu ngắn. Giữ tên GroupExpense và các quy tắc tài chính hiện có.

Tham chiếu chính thức: [Tricount](https://www.tricount.com/), [hướng dẫn quản lý khoản chi](https://help.tricount.com/en/articles/how-can-i-manage-my-tricounts-and-expenses). Tham khảo cách phân màn, danh sách và thao tác; không sao chép hình ảnh hoặc thuật toán chuyển nợ của ứng dụng mẫu.

## Quy tắc thiết kế

- Mỗi màn có một mục đích và tối đa một hành động chính nổi bật.
- Chức năng phụ nằm trong menu hoặc màn riêng. Mục đang chọn có URL riêng, tải lại và quay lại vẫn hiểu đang ở đâu.
- Dùng hàng danh sách thay cho nhiều thẻ có số liệu lặp lại. Mỗi hàng có tên, thông tin cần nhận biết và số tiền.
- Chỉ hiện chi tiết khi người dùng chọn. Không giấu form hoặc xác nhận đang thao tác trong `details` của trình duyệt.
- Danh sách có thể cuộn; tránh bắt người dùng cuộn qua phần cấu hình để đến việc chính.
- Giữ thông tin đã nhập khi đổi bước trong cùng form. Nút lưu chỉ gửi dữ liệu sau bước chia tiền.
- Câu chữ ngắn nhưng phải giữ đúng ý nghĩa: bù nợ không chuyển tiền; yêu cầu trả tiền chưa phải xác nhận; chốt số liệu chưa phải trả hết nợ.

## Tokens và thành phần

| Thành phần | Quy ước |
|---|---|
| Font | Font hệ thống iOS / Android / desktop, không tải Google Fonts |
| Chữ nội dung, form | 17px, dòng 1.5 |
| Chữ phụ | 14px; chỉ dùng cho ngày, trạng thái và thông tin phụ |
| Tiêu đề màn | 28–34px, đậm |
| Số tiền chính | 28–40px, số thẳng cột |
| Nền | `#f4f5f7`; bề mặt trắng; chữ `#1b1d22` |
| Chữ phụ | `#626771` |
| Màu tiền | Giữ token `money-in` / `money-out`; thêm dấu +/− và tên người để không phụ thuộc màu |
| Bề mặt | Bo 20px, viền nhẹ |
| Hàng điều hướng | Cao tối thiểu 72px |
| Nút chính | Cao tối thiểu 52px; các nút khác tối thiểu 44px |
| Input / select | Cao tối thiểu 48px |
| Lề điện thoại | 20px, cộng safe area khi cần |
| Độ rộng nội dung | Tối đa 42rem, căn giữa trên desktop |
| Điều hướng đáy | 4 mục; luôn ổn định khi đổi focus, chừa chỗ dưới nội dung |

Nguồn triển khai: `app/globals.css`, `components/ui/app-screen.tsx`.

| Component | Dùng cho |
|---|---|
| `PageHeader` | Tiêu đề, quay lại, ngữ cảnh và một hành động |
| `ActionLink` | Hành động chính hoặc phụ dẫn sang màn khác |
| `GroupedList` / `NavigationRow` | Menu và danh sách điều hướng |
| `SegmentedNav` | Chuyển nội dung theo URL; có `aria-current` |
| `EmptyState` | Trạng thái chưa có dữ liệu, không lặp nút chính |
| `OptionalNoteField` | Chỉ mở ô ghi chú khi cần, giữ nội dung khi thu lại |
| `loading.tsx` | Skeleton tại từng màn để chuyển trang có phản hồi ngay; không cache chung dữ liệu đăng nhập/tài chính |

## Cấu trúc màn

| Màn | Nội dung chính | Nội dung tách riêng |
|---|---|---|
| Nhóm | Danh sách nhóm, Tạo nhóm | Form `/groups/new` |
| Trong nhóm | Chi tiêu / Công nợ, Thêm khoản | Menu quản lý ở nút ba chấm |
| Thêm / sửa khoản chi | Bước Thông tin → Chia tiền | Ghi chú chỉ mở khi cần |
| Khoản chi | Số tiền, người trả, phần chia | Các món / Chi tiết; xóa nằm ở Chi tiết |
| Công nợ cá nhân | Cần trả / Cần nhận / Chờ xác nhận | Mỗi tab chỉ có tổng và danh sách liên quan |
| Khoản nợ | Số còn nợ và form trả tiền | Chi tiết / Lịch sử |
| Lần trả tiền | Trạng thái và xác nhận của đúng người | Các khoản / Lịch sử |
| Quản lý nhóm | Các lối vào chức năng | Thành viên, tên, mời, quyết toán, lịch, tạo kỳ, lưu trữ là các màn riêng |
| Kỳ quyết toán | Tổng còn nợ và các lối vào | Khoản trong kỳ / Trả nợ / Trao đổi / Tổng kết / Lịch sử / Số liệu chốt / Nhập muộn |
| Trả nợ theo kỳ | Bù nợ hoặc Trả tiền | Chỉ một cách trả nợ xuất hiện tại một thời điểm |
| Chi cố định | Danh sách mẫu | Thao tác mẫu nằm ở màn chi tiết |

Phân trang nguồn nợ vẫn dùng tổng của toàn kỳ. Màn trao đổi có phân trang riêng để chọn được các khoản sau hàng 50. Link và query cũ `?page=` vẫn mở danh sách nguồn. Quyền quản lý, quyền người tạo khoản chi và quyền hai bên của khoản nợ được kiểm tra như trước.

## Văn phong

| Trước | Hiện tại |
|---|---|
| Hóa đơn | Khoản chi |
| Nghĩa vụ gốc | Khoản nợ |
| Bù trừ công nợ hai chiều | Bù nợ |
| Snapshot / bản đối soát đã khóa | Số liệu đã chốt |
| Rà soát | Kiểm tra |
| Chi phí định kỳ | Chi cố định |
| Ghi nhận vào lịch sử | Gửi |

Nhãn phải nói rõ việc người dùng làm: Thêm khoản, Chọn người, Chốt số liệu, Trả lời. Không hiển thị tên sự kiện kỹ thuật hoặc mã UUID ở danh sách chính. Chi tiết truy vết vẫn có ở phần chi tiết hoặc bản xuất.

## Kiểm chứng

Xem [biên bản kiểm tra](MOBILE-REDESIGN-VERIFICATION.md). Bằng chứng trình duyệt dùng tài khoản và dữ liệu giả lập trên PostgreSQL local. Kiểm tra mô phỏng không thay thế nghiệm thu iPhone/Android thật, bàn phím hệ điều hành và PWA đã cài.
