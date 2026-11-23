# Tofu-Heal

Aplikasi web satu halaman yang memperkirakan pH luka dari foto sensor kurkumin. Kurkumin berubah warna menurut pH. Aplikasi menangkap sensor lewat kamera, menormalkan warnanya terhadap pencahayaan, memetakan hue ke pH antara 4 dan 10, lalu mengklasifikasikan hasilnya (misalnya normal atau waspada).

[English](README.md)

Ini prototipe riset. Ini bukan alat medis dan tidak menggantikan saran tenaga kesehatan.

## Fungsi

- Pengambilan gambar kamera dengan stensil, dan kalibrasi RGB yang ditampilkan sebagai metrik.
- Pengolahan warna di `script.js`: hue yang dinormalkan terhadap iluminan (koreksi acuan putih ke D65), penyaringan piksel ekstrem, dan pemetaan hue ke pH.
- Label status dengan nilai keyakinan, serta pesan galat bila warna terlalu pudar untuk dianalisis.
- Riwayat analisis di `localStorage`, dengan tombol untuk menghapusnya.

## Teknologi

HTML, CSS, dan JavaScript biasa dengan Canvas API dan `getUserMedia`. Ikon Lucide dimuat dari CDN. Tanpa langkah build; `index.html` adalah titik masuk dan aplikasi berjalan di GitHub Pages.

## Menjalankan

Sajikan folder lewat HTTP (kamera butuh konteks aman):

```bash
python3 -m http.server 8000
```

Buka `http://localhost:8000`.
