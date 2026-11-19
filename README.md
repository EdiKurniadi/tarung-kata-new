# Tarung Kata

Permainan kata bergiliran melawan teman atau komputer. Mode: Indonesia 5 huruf,
Inggris 5 huruf, dan Inggris 6 huruf.

## Menjalankan

Gunakan Node.js 22 atau lebih baru. Jalankan dari folder yang berisi `package.json` ini:

```powershell
npm ci
npm start
```

Buka http://localhost:3001. Server menyediakan halaman permainan sekaligus koneksi
Socket.IO, sehingga tidak perlu Live Server terpisah. Jika server versi lama masih
berjalan, hentikan proses tersebut lalu jalankan kembali setelah perubahan kode.

Untuk bermain bersama melalui Wi-Fi/LAN, kedua pemain membuka alamat server yang
sama, misalnya `http://<IP-komputer-server>:3001`, lalu membuat username berbeda.
Pilih ikon pemain, klik nama teman, tunggu undangan diterima, lalu pilih mode.
Pemain yang mengundang mendapat giliran pertama.

Port dapat diubah melalui variabel lingkungan `PORT`. Jika sengaja memisahkan
hosting client dan server, tetapkan `window.WORD_WAR_SERVER_URL` sebelum
`network.js` dimuat. Secara bawaan koneksi mengikuti alamat halaman; jika HTML
dibuka langsung melalui `file://`, koneksi mengarah ke `http://localhost:3001`.
Lawan komputer tetap tersedia saat server tidak terhubung.

## Perilaku permainan

- Waktu menebak adalah 60 detik sejak giliran dimulai, termasuk giliran pertama.
- Jawaban harus ada di kamus mode yang dipilih, belum terpakai, dan memenuhi
  kriteria dari kata sebelumnya.
- Setelah jawaban valid, waktu berhenti untuk memilih aturan. Klik kotak atau
  tekan nomor posisinya. Backspace membatalkan pilihan terakhir; Enter mengirimnya.
- Warna dipilih berurutan: hijau, jingga, merah, hitam. Mulai kata ke-4 diperlukan
  dua warna, kata ke-6 tiga warna, dan kata ke-8 empat warna. Kata awal ikut dihitung.
- Hijau wajib pada posisi yang sama. Jingga wajib ada dengan posisi bebas.
  Merah melarang huruf hanya pada posisi tersebut. Hitam melarang huruf di seluruh
  kata. Huruf hitam tidak boleh bertentangan dengan huruf hijau/jingga.
- Server menentukan giliran, validasi, batas waktu, dan hasil pertandingan teman.
  Refresh menyambungkan kembali ke pertandingan yang sama. Koneksi yang terputus
  memiliki tenggang 15 detik; waktu menebak tetap berjalan.
- Keluar saat pertandingan berlangsung dihitung kalah. Pemain yang sibuk melawan
  teman atau komputer tidak ditampilkan dalam daftar lawan yang tersedia.
- Sesi komputer dan identitas disimpan per tab agar refresh dapat melanjutkan
  permainan tanpa mencampur sesi tab lain. Menutup tab mengakhiri sesi lokalnya.

## Struktur dan pengujian

`public/match.js` adalah mesin aturan bersama untuk kedua mode.
`game.js` mengendalikan tampilan dan giliran komputer, `network.js` menangani
permintaan ke server, dan `history.js` menyimpan keadaan permainan komputer.
Server mengelola undangan, pasangan pertandingan, sambung ulang, dan timer.

Seluruh aplikasi berada dalam folder ini. Tidak membutuhkan folder client di
luarnya, hosting frontend terpisah, atau pengaturan alamat server di browser.

```powershell
npm test
```

Pengujian mencakup aturan ketiga mode, giliran komputer hingga empat warna,
pembatalan tugas komputer, pemulihan sesi, validasi identitas/giliran, undangan,
sinkronisasi Socket.IO, batas waktu, sambung ulang, dan main ulang. Tidak perlu
menghubungi layanan kamus eksternal untuk menjalankan pengujian.

Definisi kata merupakan fitur tambahan yang membutuhkan server dan layanan kamus
eksternal. Kegagalan memuat definisi tidak menghambat permainan.

## Hosting sebagai satu aplikasi

Struktur folder yang diunggah:

```text
tarung kata server/
  package.json
  package-lock.json
  index.js
  Procfile
  README.md
  public/
    index.html
    match.js
    network.js
    ... JavaScript, CSS, gambar, dan audio game
  test/
```

1. Unggah isi folder ini atau gunakan folder ini sebagai root proyek di hosting.
   Sertakan `public` beserta semua asetnya. `node_modules`, `.git`, dan file log
   tidak perlu diunggah melalui pengelola berkas atau arsip.
2. Gunakan hosting yang menjalankan proses Node.js dan mendukung Socket.IO dengan
   koneksi WebSocket. Hosting yang hanya menyajikan berkas statis tidak cukup
   untuk mode bermain bersama teman.
3. Perintah instalasi: `npm ci`. Perintah mulai: `npm start`.
   Tidak ada langkah build frontend.
4. Gunakan Node.js 22 atau lebih baru. Server membaca variabel lingkungan `PORT`
   dari hosting, dengan nilai lokal bawaan `3001`, dan mendengarkan pada `0.0.0.0`.
5. Buka domain aplikasi. Halaman, definisi kata, dan koneksi multiplayer memakai
   domain yang sama. Gunakan HTTPS yang disediakan hosting; tidak perlu menulis
   alamat IP komputer di kode client atau membuka firewall komputer pribadi.

Pertandingan online disimpan di memori proses server. Jalankan satu instance
server untuk versi ini. Restart atau deploy ulang mengakhiri pertandingan aktif;
penggunaan beberapa instance membutuhkan penyimpanan keadaan dan adapter
Socket.IO bersama terlebih dahulu.
