# ArchiveTune Desktop UI

UI desktop berbasis Electron, React, TypeScript, dan Vite. Main process memilih port loopback yang bebas dan token acak baru saat dijalankan, lalu menjalankan `gradlew.bat -p desktop/server run`. Jika `ARCHIVETUNE_YTDLP` tersedia di environment, nilainya diteruskan ke server.

## Prasyarat

- Node.js dan npm
- JDK 21
- Submodule `core` sudah diinisialisasi
- `yt-dlp` ada di `PATH` atau `ARCHIVETUNE_YTDLP` menunjuk ke executable-nya

## Menjalankan mode development

Dari folder ini:

```powershell
npm install
$env:JAVA_HOME = "C:\Path\To\JDK-21"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:ARCHIVETUNE_YTDLP = "C:\Path\To\yt-dlp.exe"
npm run dev
```

Main process menutup pohon proses server dengan `taskkill /T /F` saat aplikasi ditutup. UI development berjalan pada `http://localhost:5173`; server hanya bind ke `127.0.0.1` dan mengizinkan CORS dari origin development tersebut.

Mode packaged (`file://`) belum disiapkan. **TODO:** tentukan kebijakan CORS yang sesuai untuk renderer packaged sebelum membuat distribusi desktop.

## Build UI

```powershell
npm run build
```
