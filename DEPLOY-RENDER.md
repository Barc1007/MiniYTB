# Hướng dẫn deploy lên Render

Tài liệu này hướng dẫn từng bước đưa toàn bộ hệ thống lên **Render** bằng file Blueprint [`render.yaml`](render.yaml).

## 1. Kiến trúc khi chạy trên Render

```mermaid
flowchart LR
  U[Người dùng] --> W[myt-web<br/>Static Site · free]
  U -->|/api, /media| G[myt-gateway · free]
  G -->|HTTPS + X-Internal-Token| US[myt-user · free]
  G --> VS[myt-video · free]
  G --> SS[myt-streaming · free]
  G --> CS[myt-comment · free]
  G --> PS[myt-payment · free]
  WK[myt-worker<br/>Background Worker · trả phí] 
  US & VS & SS & CS & PS & WK <--> MQ{{CloudAMQP<br/>RabbitMQ}}
  US & VS & SS & CS & PS & WK --> DB[(MongoDB Atlas)]
  VS & SS & WK & US --> R2[/Cloudflare R2<br/>video · HLS · ảnh/]
  U -.segment video qua URL có chữ ký.-> R2
  US --> BR[Brevo<br/>email]
```

## 2. Các dịch vụ cần đăng ký

| # | Dịch vụ | Dùng để | Gói | Bắt buộc? |
|---|---|---|---|---|
| 1 | **GitHub** | Chứa source code để Render tự build | Free | ✅ |
| 2 | **Render** (render.com) | Chạy 6 web service, 1 worker, 1 static site | 7 service free + **worker trả phí** | ✅ |
| 3 | **MongoDB Atlas** (mongodb.com/atlas) | Database (5 DB riêng cho 5 service trên 1 cluster) | M0 Free (512 MB) | ✅ |
| 4 | **CloudAMQP** (cloudamqp.com) | RabbitMQ: event bus giữa các service | Little Lemur (free) | ✅ |
| 5 | **Cloudflare R2** (cloudflare.com) | Lưu video gốc, file HLS, thumbnail, avatar | Free 10 GB, không tính phí băng thông ra (cần thêm phương thức thanh toán để kích hoạt R2) | ✅ |
| 6 | **Brevo** (brevo.com) | Gửi email quên mật khẩu, chào mừng Premium | Free 300 email/ngày | Nên có |
| 7 | Google Cloud Console | Đăng nhập bằng Google | Free | Tuỳ chọn |
| 8 | VNPay Sandbox (sandbox.vnpayment.vn) | Thanh toán thử nghiệm thật | Free | Tuỳ chọn (đã có cổng giả lập) |

> **Vì sao không dùng ổ đĩa của Render?** Persistent disk của Render chỉ gắn được vào **một** service,
> trong khi video-service, streaming-worker và streaming-service đều cần đọc/ghi file. Vì vậy hệ thống
> dùng object storage (R2) với `STORAGE_DRIVER=s3`.
>
> **Vì sao gateway gọi service qua URL public?** Web service gói free của Render **không nhận** được
> traffic qua private network. Các service vẫn được bảo vệ: chúng chỉ nhận request có header
> `X-Internal-Token` (bí mật do Render sinh tự động) mà gateway gắn vào.

### Chi phí tham khảo

| Thành phần | Chi phí |
|---|---|
| 6 web service + static site (free) | 0 đ — dùng chung **750 giờ/tháng** cho cả workspace; service ngủ sau 15 phút không có request nên thực tế đủ cho demo |
| myt-worker (gói nhỏ nhất `starter`, 0.5 CPU / 512 MB) | khoảng **7 USD/tháng** (kiểm tra giá hiện hành trên render.com/pricing) |
| Atlas, CloudAMQP, R2, Brevo | 0 đ trong hạn mức free |

**Không muốn trả phí worker?** Xem mục 7 (chạy worker chung với myt-streaming ở gói free, chậm hơn nhiều).

---

## 3. Chuẩn bị các dịch vụ ngoài

### 3.1 Đưa code lên GitHub

```bash
cd MiniYTB
git remote add origin https://github.com/<tài-khoản>/MiniYTB.git
git push -u origin main
```
> File `.env` đã nằm trong `.gitignore`, không bị đẩy lên.

### 3.2 MongoDB Atlas
1. Tạo cluster **M0 Free**, chọn AWS **Singapore (ap-southeast-1)** cho gần Render Singapore.
2. *Database Access* → tạo user và mật khẩu. Nên dùng mật khẩu chỉ gồm chữ và số, để không phải mã hoá URL.
3. *Network Access* → **Add IP Address → `0.0.0.0/0`**. Render gói free không có IP tĩnh, nên phải cho phép mọi IP; bảo mật dựa vào user và mật khẩu.
4. *Connect → Drivers* → copy chuỗi dạng
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`.
   Đây là giá trị **`MONGO_URL`**. Mỗi service tự thêm tên DB riêng (`myt_users`, `myt_videos`...).

### 3.3 CloudAMQP (RabbitMQ)
1. Tạo instance **Little Lemur (Free)**, region **AWS ap-southeast-1 (Singapore)**.
2. Mở instance → copy **AMQP URL** (`amqps://user:pass@xxx.rmq.cloudamqp.com/vhost`). Đây là **`RABBITMQ_URL`**.

### 3.4 Cloudflare R2
1. Dashboard Cloudflare → **R2 Object Storage** → kích hoạt R2 → **Create bucket**, ví dụ `myt-media`. Để **private**, không bật public access.
2. **Manage R2 API Tokens → Create API token**: quyền *Object Read & Write*, áp dụng cho bucket `myt-media`. Ghi lại:
   - **Access Key ID** → `S3_ACCESS_KEY_ID`
   - **Secret Access Key** → `S3_SECRET_ACCESS_KEY`
   - Endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` → `S3_ENDPOINT`
   - Tên bucket → `S3_BUCKET`
3. Bucket → **Settings → CORS Policy**. Trình duyệt tải segment video trực tiếp từ R2 nên cần CORS. Tạm để `*`, sau mục 4 sẽ đổi thành domain thật:
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

### 3.5 Brevo (email)
1. Đăng ký → **Senders, Domains & Dedicated IPs → Senders** → thêm và xác minh email gửi (có thể dùng Gmail của bạn).
2. **SMTP & API → API Keys** → tạo key → **`BREVO_API_KEY`**.
3. **`MAIL_FROM`** = `MiniYTB <email-đã-xác-minh@gmail.com>`.

> Render gói free chặn cổng SMTP 25/465/587, nên hệ thống gửi qua **HTTP API** của Brevo (cổng 443).
> Nếu để trống `BREVO_API_KEY`, link đặt lại mật khẩu sẽ chỉ được in ra log của myt-user.

---

## 4. Tạo hệ thống trên Render bằng Blueprint

1. Render Dashboard → **New → Blueprint** → kết nối GitHub → chọn repo `MiniYTB`.
2. Render đọc `render.yaml` và hiển thị 8 service. Điền các biến được hỏi. Mỗi giá trị **chỉ nhập một lần**; các service khác tự tham chiếu.

   | Service | Biến | Giá trị |
   |---|---|---|
   | myt-user | `MONGO_URL` | chuỗi Atlas (mục 3.2) |
   | myt-user | `RABBITMQ_URL` | chuỗi CloudAMQP (mục 3.3) |
   | myt-user | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | tài khoản admin tạo lúc khởi động lần đầu (mật khẩu ≥ 8 ký tự, đặt mạnh) |
   | myt-user | `BREVO_API_KEY`, `MAIL_FROM` | mục 3.5 (có thể để trống) |
   | myt-user | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | để trống nếu chưa dùng (mục 5) |
   | myt-video | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | mục 3.4 |
   | myt-payment | `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | để trống nếu chỉ dùng cổng giả lập |

   `JWT_SECRET` và `INTERNAL_TOKEN` được Render **tự sinh**.
3. Bấm **Apply**. Lần build đầu mất khoảng 5–10 phút vì 7 image Docker được build song song.
4. Khi xong, ghi lại 2 địa chỉ:
   - Frontend: `https://myt-web(-xxxx).onrender.com`
   - Gateway: `https://myt-gateway(-xxxx).onrender.com`
5. Cập nhật **CORS của R2** (mục 3.4): đổi `"*"` thành domain frontend thật, ví dụ `["https://myt-web.onrender.com"]`.

### Kiểm tra
- Mở `https://<gateway>/api/health`. Lần đầu có thể mất khoảng 1 phút vì các service free đang thức dậy. Mọi service phải báo `"status":"up"`, riêng streaming có thêm `"storage":"up"`.
- Mở frontend → đăng nhập bằng `ADMIN_EMAIL` → tải một video ngắn → vào **Studio** xem tiến trình chuyển mã → **Quản trị → Duyệt video**.
- Kiểm thử tự động toàn bộ luồng từ máy bạn:
  ```bash
  GATEWAY=https://<gateway> ADMIN_EMAIL=... ADMIN_PASSWORD=... SMOKE_EVENT_WAIT_MS=4000 npm run smoke
  ```
  Smoke test tự xoá video và tài khoản test sau khi chạy.

---

## 5. (Tuỳ chọn) Đăng nhập Google & VNPay

**Google:** Google Cloud Console → APIs & Services → Credentials → *OAuth client ID* (Web application):
- Authorized JavaScript origins: `https://<frontend>`
- Authorized redirect URIs: `https://<gateway>/api/auth/google/callback`

Điền `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` vào **myt-user** (Environment), rồi deploy lại. Nút “Tiếp tục với Google” sẽ tự hiện.

**VNPay sandbox:** đăng ký merchant test → nhận `TMN_CODE` và `HASH_SECRET` → điền vào **myt-payment**.
- Return URL được tự đặt thành `https://<gateway>/api/payments/vnpay/return`.
- Khai báo **IPN URL** trong trang quản trị merchant: `https://<gateway>/api/payments/vnpay/ipn`.
- Khi dùng thanh toán thật, đặt `PAYMENT_MOCK_ENABLED=false`.

---

## 6. Lưu ý vận hành với gói free

- **Service ngủ sau 15 phút** không có request, và **mất khoảng 1 phút để thức dậy**. Request đầu tiên sau thời gian nghỉ sẽ chậm.
  → **Trước buổi demo**: mở `https://<gateway>/api/health` khoảng 2 phút trước để đánh thức tất cả.
- Sự kiện gửi tới service đang ngủ **không bị mất**: chúng nằm chờ trong CloudAMQP và được xử lý khi service thức dậy.
  Ví dụ: sau khi thanh toán, gói Premium có thể cập nhật chậm vài giây đến 1 phút.
- **750 giờ free/tháng dùng chung cho 6 web service.** Đừng dùng dịch vụ "ping giữ thức" cho tất cả service, vì sẽ hết giờ chỉ sau khoảng 5 ngày.
- Worker gói nhỏ (0.5 CPU) chuyển mã khá chậm: video 1 phút mất khoảng 1–3 phút. Blueprint giới hạn tối đa **720p** (`MAX_RENDITION_HEIGHT`), tài khoản free xem tối đa **480p** (`FREE_MAX_HEIGHT`), Premium xem 720p.
  Nâng worker lên `1c-2g` thì đặt `MAX_RENDITION_HEIGHT=1080` và `FREE_MAX_HEIGHT=720`.
- Giới hạn upload: free 200 MB, Premium 1 GB (`MAX_UPLOAD_MB_*` ở myt-video). Đặt vừa phải vì file đi qua gateway và service gói free.
- Xem log: Render Dashboard → chọn service → **Logs**. Xem hàng đợi và dead-letter queue `myt.dead`: CloudAMQP → RabbitMQ Manager.

## 7. Phương án tiết kiệm: không dùng worker trả phí

Xoá khối `myt-worker` trong `render.yaml`, rồi ở **myt-streaming** đổi:

```yaml
      - key: STREAMING_MODE
        value: all            # API + chuyển mã chung một service free
      - key: APK_PACKAGES
        value: ffmpeg
      - key: MAX_RENDITION_HEIGHT
        value: "480"
      - key: FFMPEG_PRESET
        value: ultrafast
```

Đánh đổi: service free chỉ có 0.1 CPU nên chuyển mã **rất chậm**. Service có thể ngủ giữa chừng nếu 15 phút không có request; khi đó việc dở dang được RabbitMQ giao lại sau khi service thức dậy. Phương án này chỉ phù hợp để demo với video rất ngắn.

## 8. Tên service bị trùng

Nếu `myt-gateway`... đã có người dùng, Render tự thêm hậu tố vào URL (`myt-gateway-ab12.onrender.com`).
Không cần sửa gì: các URL giữa service được lấy tự động qua `fromService` trong Blueprint.
Chỉ cần dùng đúng URL thật ở các bước cấu hình bên ngoài (CORS R2, Google, VNPay).
