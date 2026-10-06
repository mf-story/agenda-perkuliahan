#!/bin/sh
set -e

# Pastikan folder data & unggahan ada (akan jadi Persistent Storage di Coolify)
mkdir -p /app/data /app/uploads

# Isi data awal HANYA jika volume data masih kosong (deploy pertama kali).
# Setelah itu, data di volume yang dipakai (perubahan runtime tetap tersimpan).
if [ ! -f /app/data/db.json ] && [ -f /app/seed-db.json ]; then
  cp /app/seed-db.json /app/data/db.json
  echo "Data awal disalin ke /app/data/db.json (96 pertemuan + akun)."
fi

exec node server.js
