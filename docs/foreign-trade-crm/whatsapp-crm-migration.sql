BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS crm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_message_id TEXT,
  thread_id TEXT,
  customer_id INTEGER,
  inquiry_id INTEGER,
  direction TEXT NOT NULL,
  sender_name TEXT,
  sender_contact TEXT,
  receiver_contact TEXT,
  message_text TEXT NOT NULL,
  attachments_json TEXT,
  raw_payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  workflow_status TEXT NOT NULL DEFAULT 'pending',
  dedupe_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_messages_dedupe_hash ON crm_messages(dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_crm_messages_customer ON crm_messages(customer_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_inquiry ON crm_messages(inquiry_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_source ON crm_messages(source_type, direction, ai_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp ON customers(whatsapp);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name_lookup ON customers(company_name, name, contact_person);

COMMIT;
