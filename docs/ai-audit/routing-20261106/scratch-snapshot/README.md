# Scratch snapshot (che thông tin)

Bản chụp mã scratch đang chạy, để đối chiếu với core. Không phải mã của repo, không chạy từ đây; đuôi `.txt` để không ai nhầm là mã được dùng.

- `SHA1SUMS.txt`: SHA1 và giờ sửa của **file gốc trước khi che**. Vì đã che, SHA1 của bản `.txt` sẽ khác.
- Đã thay: đường dẫn máy thành `<scratch>`, `<home>`, `<runs>`; tên lane thành `<lane>`, `<task>`.
- Không kèm: log, prompt thật của worker, cookie, key, dữ liệu tài khoản, `aa-scores.json`.
- Tên biến môi trường và tên model được giữ vì cần để đọc code.
