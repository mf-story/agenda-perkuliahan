# Menjalankan Agenda Perkuliahan dengan Node.js (untuk Coolify/Docker)
FROM node:20-alpine
WORKDIR /app

# Install dependensi (web-push) — manfaatkan cache layer
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Salin semua berkas aplikasi (termasuk seed-db.json)
COPY . .

# Pastikan entrypoint bisa dieksekusi & berakhiran LF
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

# Data & unggahan disimpan di folder ini — pasang Persistent Storage di Coolify:
#   /app/data      (berisi db.json)
#   /app/uploads   (berkas tugas mahasiswa)
ENV PORT=80
EXPOSE 80

ENTRYPOINT ["./docker-entrypoint.sh"]
