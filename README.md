# LifeOS

A private, local-only personal admin app: budget, net worth, non-monthly
expenses, contacts, birthdays, to-dos, notes, medication reorder tracking,
home, vehicles, and contracts.

## Running it

No build step or server needed.

1. Unzip this folder.
2. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).

That's it — the whole app runs client-side.

## Data & privacy

- Everything is stored in your browser's **local storage**, on your device
  only. Nothing is sent anywhere.
- Use **Preferences & Data → Data** in the sidebar to export a JSON backup,
  import a previous backup, or permanently delete all data.
- Local storage is per-browser, per-device. To move your data to another
  browser or computer, export the JSON on the old one and import it on the
  new one.

## Notes on a couple of features

- **Medication reorder date**: for each medication, log every prescription
  (date, strength, quantity). LifeOS works out your current estimated stock
  from dose-per-day and prescription history (carrying forward whatever was
  left before adding each new prescription), then tells you how many days
  until — or how many days overdue — you should reorder, based on your
  reorder-lead preference (Health page).
- **Contacts**: the default fields (name, DOB, contact info, address, bank
  info, sensitive info, key dates, links to other contacts) support multiple
  entries where useful (e.g. more than one phone number). You can add your
  own custom fields to every contact from Preferences & Data → Contact fields.
- **Theme**: toggle dark/light from the sidebar; your choice is remembered.
