# Smart Hospital OPD – Full Stack

No `npm install` needed (zero dependencies). Requires Node.js 18+.

## Run on your computer
```
cd smart-hospital
node server.js
```
Open http://localhost:3000

## Folder
- `server.js` – backend (API + data storage)
- `public/index.html` – your frontend, now connected to the backend
- `data/db.json` – created automatically; all patient records are saved here

## Staff PINs (change before hosting!)
Set these environment variables:

| Variable | Role | Default (demo) |
|---|---|---|
| `RECEPTION_PIN` | Reception | 1111 |
| `DOCTOR_PIN` | Doctor | 2222 |
| `PHARMACY_PIN` | Pharmacy & Billing | 3333 |
| `SECRET` | Login signing key (any long random text) | random |
| `DATA_DIR` | Folder to store `db.json` | ./data |

Patients (and your friend filling the form on a phone) see only the **Registration** page.
Staff open **Staff Login**, pick a role and enter the PIN to see the other dashboards.

## Host on Render.com
1. Upload this folder to a GitHub repository.
2. Render → New → **Web Service** → pick the repo.
3. Build command: *(leave empty)*  Start command: `node server.js`
4. Add the environment variables above.
5. **Important:** Render's free disk is wiped on every redeploy/restart. To keep data, add a *Persistent Disk* (paid) mounted at `/var/data` and set `DATA_DIR=/var/data`. For a class demo, just use the **Export CSV** button in Reception to save a copy.

Railway, Fly.io or any VPS also work: `node server.js`, and the host sets `PORT` automatically.

## QR code
Make a QR code of your hosted URL (e.g. via qr-code-generator.com) and print it for the registration desk.

## What changed from the demo
- Records live on the server, not in the browser – phones register, staff see it live (auto-refresh every 5 s).
- **Billing moved from Doctor to Pharmacy:** doctor only writes note + prescription; pharmacy sets consultation fee, adds medicines (qty × price), chooses Cash/UPI/Card, marks paid (bill then locks) and downloads the receipt.
- Tokens restart at OP-001 each day (India time).
- Patients can check their token status with token + mobile number.
- Basic protection: role PINs, signed sessions, rate limits on registration/login, input validation.

## API summary
Public: `POST /api/register`, `GET /api/status`, `POST /api/login`
Staff: `GET /api/patients`, `POST /api/call-next`, `PUT /api/patients/:id/consult` (doctor), `PUT /api/patients/:id/bill` (pharmacy), `GET /api/export.csv`, `POST /api/reset` (reception)
