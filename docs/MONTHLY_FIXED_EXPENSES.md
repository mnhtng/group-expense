# Chi phí cố định hằng tháng

> Áp dụng cho dự án Next.js + PostgreSQL `pg` **không ORM**. 
> Trạng thái: feature trên nhánh `develop`; chỉ chạy tự động trên production sau khi triển khai migration và Vercel Cron.

## Phạm vi

- Tạo mẫu chi phí nhóm với **tên**, **người ứng tiền**, **ngày lặp 1–31**, **ngày bắt đầu**, **ghi chú tùy chọn**.
- Dùng lại form hóa đơn nhiều dòng: món, số lượng, giá, chia đều hoặc nhập tỷ lệ bằng số tiền cho từng thành viên.
- Lưu **phân bổ cố định chính xác** theo từng thành viên; không tính lại theo số lượng thành viên mới gia nhập.
- Ngày lặp 29–31 sẽ chuyển về cuối tháng ngắn (ví dụ ngày 31 → 28/2, hoặc 29/2 vào năm nhuận).
- Chỉ từ ngày bắt đầu đã chọn, không tự tạo hóa đơn cho tháng trước khi đăng ký.
- Khi đến hạn tạo hóa đơn thường (itemized + obligation ledger) **với người tạo là tác giả của mẫu**. Chỉ tác giả có quyền sửa/xóa/chốt những hóa đơn này, tuân thủ quy tắc đã có.
- Công nợ chỉ giảm khi hai bên xác nhận thanh toán. Chốt hoàn thành hóa đơn vẫn do người tạo xác nhận riêng.
- Tạo/sửa mẫu chỉ ảnh hưởng **các kỳ chưa phát sinh**. Không sửa lịch sử các kỳ đã có.
- Tạm dừng: không tạo hóa đơn tương lai; tiếp tục: lấy thời điểm bắt đầu mới là ngày tiếp tục, **không truy thu tự động** các tháng đã tạm dừng.
- Nếu người tạo/người ứng tiền/người tham gia không còn là thành viên hoạt động, mẫu **tự tạm dừng** thay vì phát sinh công nợ sai.
- Không tự xóa mẫu; lịch sử các kỳ và hóa đơn gốc được bảo toàn.

## UI

Từ chi tiết nhóm → **Chi phí cố định hằng tháng**:

1. Thêm chi phí → nhập mẫu giống nhập hóa đơn nhiều món → chọn ngày phát sinh mỗi tháng.
2. Theo dõi danh sách đang chạy và tạm dừng, số tiền dự kiến, ngày kỳ tiếp theo.
3. Người tạo có thể Sửa mẫu / Tạm dừng / Tiếp tục.
4. **Tạo kỳ đến hạn**: xử lý ngay khi lịch đang đến hạn. Có thể nhấn lại an toàn, sẽ không tạo trùng.
5. Chi tiết một mẫu hiển thị hóa đơn từng tháng, liên kết vào hóa đơn gốc.

### Quy tắc thời gian

- DB/API: ISO `YYYY-MM-DD`. UI: `d/m/yyyy`, múi giờ Việt Nam.
- Vercel Cron dùng sẵn đường dẫn `/api/internal/push-drain` tại **02:00 UTC** (tương đương **09:00 Asia/Ho_Chi_Minh**).
- Trên Vercel Hobby cron chỉ được chạy **mỗi ngày một lần**, không đảm bảo đúng phút. Cron chỉ chạy production, **không chạy trong preview**. Nút manual cho phép kiểm thử staging.
- Cron yêu cầu secret `CRON_SECRET` trong môi trường. Thiếu secret thì API trả 401; tuyệt đối không public cron endpoint.
- Do Vercel Cron là least-once-style callback, cặp `UNIQUE(rule_id,period)` và lock group `FOR UPDATE` ngăn tạo trùng dù request lặp hay chạy song song.
- Worker tạo tối đa 20 hóa đơn/lượt; kỳ quá hạn có thể được tạo bù trong những lần chạy sau nếu mẫu liên tục hoạt động (tối đa 120 kỳ rà soát).

## Schema

`010_monthly_recurring_expenses.sql` thêm:
- `recurring_expense_rules`: mẫu, chia tiền JSONB chuẩn hóa, tổng, người tạo, người ứng, ngày lặp, ngày bắt đầu, trạng thái, version.
- `recurring_expense_occurrences`: liên kết mỗi `rule_id` + `period` đến một hóa đơn duy nhất, có ngày phát sinh thực tế.
- Hóa đơn thực dùng bảng `expenses`, `expense_items`, `obligations`, `expense_events` có sẵn, không xây ledger khác.

## Release

1. Áp dụng migration 010 lên đúng **Neon branch development** trước khi chạy preview.
2. Xác nhận CI: typecheck, lint, unit, integration, HTTP smoke.
3. Deploy `develop` lên Vercel Preview; kiểm thử 2 user một mẫu, 2 lần tạo kỳ, phải có đúng 1 bill.
4. Chỉ đưa vào `main` sau khi đã quyết định triển khai production và migration 010 cho production.
5. Production Cron tự chạy sau khi deploy production; preview không có Cron.

## Lưu ý nghiệp vụ

- Số tiền phải biết trước, định kỳ cùng một mức. Các chi phí biến đổi theo từng tháng như điện nước theo số công tơ nên nhập hóa đơn thực tế riêng hoặc tạo/sửa mẫu trước kỳ tiếp theo.
- Việc “tạo hóa đơn” không có nghĩa ứng dụng đã chuyển tiền hoặc tự thu tiền qua ngân hàng.
- Nếu xóa hóa đơn định kỳ đã tạo, hệ thống vẫn ghi nhận kỳ đó đã phát sinh và **không tạo lại** cùng kỳ tự động để tránh ghi nợ hai lần.
- Không dùng ORM (Prisma/Drizzle). Mọi thao tác dùng SQL tham số hóa qua `pg`.
