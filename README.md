# Tofu-Heal

Tofu-Heal is a single-page web app that estimates the pH of a wound from a photo of a curcumin-based color sensor placed on it, built around a simple chemical fact: curcumin changes color predictably as pH changes, shifting from bright yellow in acidic conditions toward orange and red as pH rises, which happens to track one signal of how a wound is healing. The app walks a user through capturing the sensor with a phone camera, then does the actual measurement itself instead of asking the user to eyeball the color against a reference chart.

[Baca dalam Bahasa Indonesia di bawah](#bahasa-indonesia)

This is a research prototype, not a medical device, and it does not replace advice from a clinician.

## How the analysis works

- **Capture**: the camera view is constrained to a stencil so the sensor is framed consistently from one reading to the next, and metrics about the current RGB calibration are shown live so a clearly bad shot (wrong lighting, sensor out of frame) is obvious before the analysis even runs.
- **Illuminant-normalized hue**: raw camera color is skewed by whatever light is in the room, so before anything else, `script.js` corrects the captured color toward a D65 white-reference illuminant. Skipping this step would mean the same physical pH reads differently indoors versus in daylight.
- **Extreme-pixel filtering**: a handful of overexposed or underexposed pixels (a glare spot, a shadow) can otherwise skew the average color reading; these are filtered out before the hue is computed.
- **Hue-to-pH mapping**: the corrected hue angle is mapped to a pH value between 4 and 10, the physiologically plausible range for a wound, clamped at both ends rather than extrapolating into a reading that would not make biological sense.
- **Classification**: the resulting pH is turned into a label (for example "healthy wound" or "warning") with a confidence value attached, and the app shows a clear error, rather than a fabricated-looking number, when the color is too faded for the reading to be trustworthy.
- **History**: every analysis is kept in `localStorage`, with a button to clear it, so a trend over several days of dressing changes can be reviewed.

## Tech stack

Plain HTML, CSS and JavaScript, using the Canvas API for pixel-level color extraction and `getUserMedia` for camera access. Lucide icons are loaded from a CDN. There is no build step: `index.html` is the entry point, and the whole thing runs as-is on GitHub Pages.

## Running it

The camera API requires a secure context, so open the folder over HTTP rather than as a local file:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

---

## Bahasa Indonesia

Tofu-Heal adalah aplikasi web satu halaman yang memperkirakan pH luka dari foto sensor warna berbasis kurkumin yang ditempel padanya, dibangun di atas fakta kimia sederhana: kurkumin berubah warna secara dapat diprediksi seiring perubahan pH, bergeser dari kuning cerah pada kondisi asam menuju oranye dan merah seiring pH naik, yang kebetulan melacak salah satu tanda bagaimana sebuah luka sedang sembuh. Aplikasi ini memandu pengguna menangkap sensor lewat kamera HP, lalu benar-benar melakukan pengukurannya sendiri, bukan meminta pengguna menebak warna dengan mata dibandingkan kartu referensi.

Ini prototipe riset, bukan alat medis, dan tidak menggantikan saran tenaga kesehatan.

### Cara analisis bekerja

- **Pengambilan gambar**: tampilan kamera dibatasi pada sebuah stensil sehingga sensor terbingkai konsisten dari satu pembacaan ke pembacaan lain, dan metrik kalibrasi RGB saat itu ditampilkan langsung sehingga jepretan yang jelas buruk (pencahayaan salah, sensor keluar bingkai) terlihat sebelum analisis berjalan.
- **Hue yang dinormalkan terhadap iluminan**: warna mentah kamera condong karena cahaya apa pun di ruangan itu, jadi sebelum apa pun, `script.js` mengoreksi warna yang ditangkap menuju acuan putih iluminan D65. Melewatkan langkah ini berarti pH fisik yang sama bisa terbaca berbeda di dalam ruangan dibanding di bawah cahaya siang.
- **Penyaringan piksel ekstrem**: segelintir piksel yang terlalu terang atau terlalu gelap (titik kilau, bayangan) bisa mencondongkan rata-rata pembacaan warna; piksel-piksel ini disaring sebelum hue dihitung.
- **Pemetaan hue ke pH**: sudut hue yang sudah dikoreksi dipetakan ke nilai pH antara 4 dan 10, rentang yang secara fisiologis masuk akal untuk luka, dibatasi di kedua ujungnya daripada diekstrapolasi ke pembacaan yang tidak masuk akal secara biologis.
- **Klasifikasi**: pH yang dihasilkan diubah menjadi label (misalnya "luka sehat" atau "waspada") dengan nilai keyakinan yang menyertainya, dan aplikasi menampilkan galat yang jelas, bukan angka yang terlihat seperti dikarang, saat warnanya terlalu pudar untuk dipercaya hasilnya.
- **Riwayat**: setiap analisis tersimpan di `localStorage`, dengan tombol untuk menghapusnya, sehingga tren selama beberapa hari pergantian perban bisa ditinjau.

### Teknologi

HTML, CSS, dan JavaScript biasa, memakai Canvas API untuk ekstraksi warna tingkat piksel dan `getUserMedia` untuk akses kamera. Ikon Lucide dimuat dari CDN. Tidak ada langkah build: `index.html` adalah titik masuk, dan semuanya berjalan apa adanya di GitHub Pages.

### Menjalankan

API kamera butuh konteks aman, jadi buka folder ini lewat HTTP, bukan sebagai berkas lokal:

```bash
python3 -m http.server 8000
```

Lalu buka `http://localhost:8000`.
