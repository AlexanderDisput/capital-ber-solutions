CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submitted_at TEXT NOT NULL,
  name TEXT NOT NULL,
  first_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  eircode TEXT,
  property_type TEXT,
  whatsapp_consent INTEGER NOT NULL DEFAULT 0,
  whatsapp_sent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'New',
  difficulty TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS lead_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
