# ArchiveTune desktop server

Server lokal ini memakai modul JVM `core` untuk mencari lagu YouTube Music. Build Gradle di folder ini berdiri sendiri dan hanya memasukkan `:core`; modul Android `:app` tidak digunakan.

## Prasyarat

- JDK 21
- Submodule `core` sudah diinisialisasi pada `../../core`. Jika folder itu belum berisi source, jalankan dari root repository:

  ```powershell
  git submodule update --init core
  ```
- `yt-dlp` tersedia di `PATH`, atau atur `ARCHIVETUNE_YTDLP` ke path binary-nya. Server mencoba `yt-dlp` terlebih dahulu untuk resolusi URL stream, lalu memakai InnerTube sebagai fallback.

## Menjalankan

Dari root repository, jalankan di PowerShell:

```powershell
$env:ARCHIVETUNE_PORT = "43127"
$env:ARCHIVETUNE_TOKEN = [guid]::NewGuid().ToString("N")
$env:ARCHIVETUNE_YTDLP = "C:\Path\To\yt-dlp.exe" # opsional jika yt-dlp tidak ada di PATH
$env:ARCHIVETUNE_TOKEN
.\gradlew.bat -p desktop\server run
```

Server hanya bind ke `127.0.0.1`. Kedua environment variable wajib diisi; port harus berupa angka antara 1 dan 65535. Hentikan server dengan `Ctrl+C`.

## Menguji di browser

Ganti `<token>` dengan nilai yang sama seperti `ARCHIVETUNE_TOKEN`:

- Health: `http://127.0.0.1:43127/health?t=<token>` - respons `{"status":"ok"}`
- Cari lagu: `http://127.0.0.1:43127/search?q=daft%20punk&t=<token>` - respons berupa array hasil lagu dengan field `id`, `title`, `artists`, `album`, `durationSec`, `thumbnail`, dan `explicit`
- Stream audio: `http://127.0.0.1:43127/stream/<videoId>?t=<token>` - audio diproxy dari YouTube, dengan dukungan header `Range` dan respons `200`/`206`

Setiap endpoint memerlukan parameter `t`. Permintaan tanpa token yang cocok mendapat HTTP 401. Parameter `q` yang kosong atau tidak ada mendapat HTTP 400. ID video stream wajib tepat 11 karakter `[A-Za-z0-9_-]`; ID tidak valid mendapat HTTP 400.

## Menguji stream

Jalankan perintah dari PowerShell setelah server aktif, dengan mengganti `<videoId>` dan `<token>`:

```powershell
curl.exe -L "http://127.0.0.1:43127/stream/<videoId>?t=<token>" -o lagu.m4a
curl.exe -L -H "Range: bytes=0-1048575" "http://127.0.0.1:43127/stream/<videoId>?t=<token>" -o potongan.m4a
```

Perintah kedua meminta 1 MiB pertama. Jika upstream mendukung range, responsnya `206 Partial Content` beserta `Content-Range`. File unduhan pertama seharusnya dapat dibuka sebagai audio bila stream yang dipilih berformat MP4/AAC.

Untuk menguji pemutaran di browser, buka halaman lokal yang memuat elemen berikut, lalu isi URL dengan ID video dan token:

```html
<audio controls src="http://127.0.0.1:43127/stream/<videoId>?t=<token>"></audio>
```

Gunakan token lokal yang sama dengan `ARCHIVETUNE_TOKEN`; jangan membagikan URL bertoken.
