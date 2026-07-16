const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

function initDb() {
  db.exec(`
    
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      approved_at TEXT,
      full_name TEXT,
      permissions_json TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      bag_type TEXT NOT NULL,
      use_case TEXT,
      size_json TEXT,
      order_qty TEXT,
      order_spec TEXT,
      status TEXT NOT NULL DEFAULT '印刷',
      urgency INTEGER NOT NULL DEFAULT 0,
      assigned_print_worker TEXT,
      assigned_lamination_worker TEXT,
      assigned_bagging_worker TEXT,
      assigned_shipping_worker TEXT,
      legacy_openid TEXT,
      legacy_order_state TEXT,
      legacy_source_key TEXT,
      legacy_json TEXT,
      created_by TEXT NOT NULL,
      start_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      quote_type TEXT NOT NULL,
      internal_json TEXT NOT NULL,
      customer_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quote_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      customer_name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      bag_type TEXT,
      specs_json TEXT,
      input_json TEXT,
      calc_json TEXT,
      quantity INTEGER,
      unit_price REAL,
      amount REAL,
      cost REAL,
      profit_rate REAL,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS material_prices (
      code TEXT PRIMARY KEY,
      prop REAL,
      price REAL NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS material_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_name TEXT NOT NULL,
      normalized_material TEXT NOT NULL,
      display_name_cn TEXT,
      density REAL,
      price REAL,
      price_unit TEXT,
      confidence TEXT NOT NULL DEFAULT 'medium',
      needs_confirm INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(raw_name)
    );

    CREATE TABLE IF NOT EXISTS foreign_costing_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_inquiry_id INTEGER,
      customer_id INTEGER,
      customer_name TEXT,
      source_text TEXT,
      parsed_spec_json TEXT,
      material_mapping_json TEXT,
      quote_input_json TEXT,
      quote_result_json TEXT,
      calculation_table_json TEXT,
      ai_provider TEXT,
      ai_model TEXT,
      status TEXT NOT NULL DEFAULT 'internal_pre_quote',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS foreign_costing_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id INTEGER NOT NULL,
      reviewer TEXT,
      reviewed_input_json TEXT,
      reviewed_result_json TEXT,
      approved_unit_price REAL,
      approved_total_price REAL,
      father_note TEXT,
      father_correction_note TEXT,
      changed_fields_json TEXT,
      status TEXT NOT NULL DEFAULT 'reviewed',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cost_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      cost_type TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS salespersons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_id INTEGER,
      name TEXT NOT NULL,
      contact TEXT,
      phone TEXT,
      default_bag_type TEXT,
      default_spec TEXT,
      default_use_case TEXT,
      default_roller TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(salesperson_id, name)
    );

    CREATE TABLE IF NOT EXISTS communication_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      inquiry_id INTEGER,
      channel TEXT,
      direction TEXT,
      sender TEXT,
      recipient TEXT,
      subject TEXT,
      raw_content TEXT,
      ai_summary TEXT,
      attachments_json TEXT,
      message_id TEXT,
      thread_id TEXT,
      received_at TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );

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
      dedupe_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crm_message_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      conversation_id TEXT,
      customer_id INTEGER,
      inquiry_id INTEGER,
      source_type TEXT,
      source_message_id TEXT,
      whatsapp_message_id TEXT,
      email_message_id TEXT,
      original_file_name TEXT,
      stored_file_name TEXT,
      mime_type TEXT,
      file_ext TEXT,
      file_size INTEGER DEFAULT 0,
      storage_path TEXT,
      public_url TEXT,
      preview_url TEXT,
      thumbnail_url TEXT,
      attachment_type TEXT DEFAULT 'other',
      media_order INTEGER DEFAULT 1,
      caption_text TEXT,
      ai_status TEXT DEFAULT 'skipped',
      ai_summary_cn TEXT,
      ai_summary_en TEXT,
      extracted_specs_json TEXT,
      risk_flags_json TEXT,
      raw_metadata_json TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS crm_ai_interpretations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      customer_id INTEGER,
      inquiry_id INTEGER,
      provider TEXT NOT NULL DEFAULT 'rule_based',
      model TEXT,
      parsed_json TEXT NOT NULL,
      changed_fields_json TEXT,
      status TEXT NOT NULL DEFAULT 'parsed',
      error_message TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crm_father_review_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      inquiry_id INTEGER,
      source_message_id INTEGER,
      interpretation_id INTEGER,
      task_type TEXT NOT NULL DEFAULT 'general',
      question_cn TEXT NOT NULL,
      ai_context_cn TEXT,
      customer_original_text TEXT,
      attachment_ids_json TEXT,
      required_fields_json TEXT,
      father_reply_cn TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sales_handled_at TEXT,
      sales_handled_by TEXT,
      sales_note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS crm_reply_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      inquiry_id INTEGER,
      source_message_id INTEGER,
      source_interpretation_id INTEGER,
      father_task_id INTEGER,
      costing_draft_id INTEGER,
      source_type TEXT,
      reply_channel TEXT,
      recipient_contact TEXT,
      email_subject TEXT,
      draft_text_en TEXT NOT NULL,
      draft_text_cn TEXT,
      draft_summary_cn TEXT,
      generation_method TEXT NOT NULL DEFAULT 'rule_based',
      tone TEXT NOT NULL DEFAULT 'professional',
      status TEXT NOT NULL DEFAULT 'draft',
      risk_flags_json TEXT,
      missing_info_json TEXT,
      referenced_attachment_ids_json TEXT,
      crm_context_json TEXT,
      created_by TEXT,
      updated_by TEXT,
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inquiry_code TEXT,
      customer_id INTEGER,
      inquiry_title TEXT,
      product_type TEXT,
      application TEXT,
      packaging_type TEXT,
      status TEXT DEFAULT 'new',
      priority TEXT DEFAULT 'C',
      quantity TEXT,
      destination_country TEXT,
      destination_port TEXT,
      destination_address TEXT,
      trade_term_requested TEXT,
      customer_target_price TEXT,
      missing_info TEXT,
      customer_questions TEXT,
      technical_risks TEXT,
      commercial_risks TEXT,
      costing_required INTEGER DEFAULT 0,
      latest_specification_id INTEGER,
      latest_cost_sheet_id INTEGER,
      latest_quote_id INTEGER,
      order_id INTEGER,
      next_action TEXT,
      next_followup_at TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inquiry_specifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inquiry_id INTEGER,
      version_no INTEGER,
      is_current INTEGER DEFAULT 1,
      product_type TEXT,
      bag_type TEXT,
      film_type TEXT,
      size_width TEXT,
      size_height TEXT,
      gusset_size TEXT,
      roll_width TEXT,
      roll_length TEXT,
      repeat_length TEXT,
      thickness_total TEXT,
      thickness_unit TEXT,
      material_structure_text TEXT,
      printing_colors TEXT,
      surface_finish TEXT,
      zipper_required INTEGER DEFAULT 0,
      valve_required INTEGER DEFAULT 0,
      spout_required INTEGER DEFAULT 0,
      tear_notch_required INTEGER DEFAULT 0,
      window_required INTEGER DEFAULT 0,
      filling_weight TEXT,
      packing_machine_type TEXT,
      artwork_status TEXT,
      notes TEXT,
      source_communication_id INTEGER,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS specification_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specification_id INTEGER,
      layer_order INTEGER,
      material_name TEXT,
      material_code TEXT,
      thickness TEXT,
      thickness_unit TEXT,
      layer_role TEXT,
      is_customer_required INTEGER DEFAULT 0,
      is_system_suggested INTEGER DEFAULT 0,
      is_confirmed_by_costing INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS costing_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      costing_request_code TEXT UNIQUE,
      customer_id INTEGER,
      inquiry_id INTEGER,
      specification_id INTEGER,
      requested_by TEXT,
      assigned_to TEXT,
      assigned_to_user_id INTEGER,
      status TEXT DEFAULT 'pending',
      request_note TEXT,
      required_quote_terms TEXT,
      required_currency TEXT,
      required_unit TEXT,
      target_margin TEXT,
      customer_target_price TEXT,
      urgency TEXT DEFAULT 'normal',
      due_at TEXT,
      completed_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cost_sheet_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cost_sheet_id INTEGER,
      cost_snapshot_id INTEGER,
      costing_request_id INTEGER,
      inquiry_id INTEGER,
      specification_id INTEGER,
      line_type TEXT,
      item_name TEXT,
      material_code TEXT,
      layer_order INTEGER,
      thickness TEXT,
      quantity TEXT,
      unit TEXT,
      unit_price TEXT,
      amount TEXT,
      currency TEXT,
      supplier TEXT,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS freight_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      freight_quote_code TEXT UNIQUE,
      customer_id INTEGER,
      inquiry_id INTEGER,
      assigned_to TEXT,
      assigned_to_user_id INTEGER,
      quote_source TEXT,
      forwarder_name TEXT,
      forwarder_contact TEXT,
      shipping_mode TEXT,
      origin_city TEXT,
      origin_port TEXT,
      destination_country TEXT,
      destination_port TEXT,
      destination_address TEXT,
      container_type TEXT,
      cargo_weight TEXT,
      cargo_volume TEXT,
      package_type TEXT,
      package_count TEXT,
      trade_term TEXT,
      currency TEXT,
      ocean_freight TEXT,
      air_freight TEXT,
      trucking_origin TEXT,
      trucking_destination TEXT,
      documentation_fee TEXT,
      thc_origin TEXT,
      thc_destination TEXT,
      customs_clearance_fee TEXT,
      duty_tax_estimate TEXT,
      destination_local_charge TEXT,
      delivery_fee TEXT,
      insurance_fee TEXT,
      other_fee TEXT,
      total_freight_cost TEXT,
      valid_from TEXT,
      valid_until TEXT,
      quote_file_url TEXT,
      notes TEXT,
      status TEXT DEFAULT 'draft',
      is_current INTEGER DEFAULT 1,
      version_no INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customer_research_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      source_type TEXT,
      title TEXT,
      research_summary TEXT,
      customer_type TEXT,
      industry TEXT,
      main_products TEXT,
      website TEXT,
      country TEXT,
      city TEXT,
      company_size_note TEXT,
      buyer_authenticity_note TEXT,
      business_match_note TEXT,
      risk_flags TEXT,
      suggested_priority TEXT,
      suggested_next_action TEXT,
      sources_json TEXT,
      raw_input TEXT,
      parsed_json TEXT,
      status TEXT DEFAULT 'active',
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS email_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox TEXT,
      folder TEXT,
      sync_type TEXT,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      finished_at TEXT,
      scanned_count INTEGER DEFAULT 0,
      inserted_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_by TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS email_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox TEXT,
      folder TEXT,
      message_uid TEXT,
      message_id TEXT,
      thread_id TEXT,
      in_reply_to TEXT,
      references_header TEXT,
      from_email TEXT,
      from_name TEXT,
      to_emails TEXT,
      cc_emails TEXT,
      bcc_emails TEXT,
      subject TEXT,
      text_body TEXT,
      html_body TEXT,
      cleaned_text TEXT,
      attachments_json TEXT,
      sent_at TEXT,
      received_at TEXT,
      direction TEXT,
      processing_status TEXT DEFAULT 'new',
      normalized_subject TEXT,
      conversation_key TEXT,
      email_domain TEXT,
      contact_email TEXT,
      contact_name TEXT,
      noise_level TEXT DEFAULT 'low',
      business_relevance TEXT DEFAULT 'low',
      detected_signals_json TEXT,
      parser_hints_json TEXT,
      quote_detected INTEGER DEFAULT 0,
      inquiry_detected INTEGER DEFAULT 0,
      customer_detected INTEGER DEFAULT 0,
      parsed_at TEXT,
      matched_customer_id INTEGER,
      matched_inquiry_id INTEGER,
      raw_headers_json TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS crm_import_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT,
      source_id INTEGER,
      suggestion_type TEXT,
      status TEXT DEFAULT 'pending',
      confidence TEXT,
      matched_customer_id INTEGER,
      matched_inquiry_id INTEGER,
      extracted_json TEXT,
      suggested_updates_json TEXT,
      risk_flags TEXT,
      summary TEXT,
      raw_input TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS email_ai_analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_code TEXT UNIQUE,
      scope_type TEXT,
      scope_key TEXT,
      status TEXT DEFAULT 'pending',
      model_provider TEXT DEFAULT 'codex_cli',
      prompt_path TEXT,
      output_path TEXT,
      input_email_ids_json TEXT,
      input_summary TEXT,
      result_json TEXT,
      error_message TEXT,
      created_by TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_no TEXT NOT NULL UNIQUE,
      salesperson_id INTEGER,
      customer_id INTEGER,
      salesperson_name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      bag_type TEXT NOT NULL,
      spec TEXT NOT NULL,
      quantity TEXT NOT NULL,
      delivery_date TEXT,
      roller TEXT,
      remark TEXT,
      process_requirements_json TEXT,
      version_no INTEGER NOT NULL DEFAULT 1,
      parent_work_order_id INTEGER,
      order_id INTEGER,
      sync_to_order INTEGER NOT NULL DEFAULT 0,
      email_to TEXT,
      email_cc TEXT,
      email_status TEXT,
      email_error TEXT,
      export_excel_path TEXT,
      export_pdf_path TEXT,
      order_image_url TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_id INTEGER,
      customer_id INTEGER,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_order_preview_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_id INTEGER,
      salesperson_name TEXT,
      customer_name TEXT,
      product_name TEXT,
      bag_type TEXT,
      spec TEXT,
      quantity TEXT,
      roller TEXT,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cost_email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      cost_type TEXT NOT NULL,
      to_list TEXT,
      cc_list TEXT,
      status TEXT NOT NULL,
      error TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_stage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      source TEXT NOT NULL,
      qty REAL,
      unit TEXT,
      operated_by TEXT,
      role TEXT,
      event_type TEXT NOT NULL DEFAULT 'COMPLETE',
      rolled_back INTEGER NOT NULL DEFAULT 0,
      rollback_of_log_id INTEGER,
      rollback_reason TEXT,
      extra_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(order_id, user_name)
    );

    CREATE TABLE IF NOT EXISTS stock_screen_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      board TEXT,
      pct REAL,
      turnover REAL,
      volume_ratio REAL,
      market_cap REAL,
      score REAL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT,
      source TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_watchlist_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT,
      close REAL,
      pct REAL,
      ma5 REAL,
      ma10 REAL,
      ma20 REAL,
      ma60 REAL,
      vol_ratio REAL,
      buy_index REAL,
      trend TEXT,
      signal TEXT,
      risk TEXT,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(trade_date, code)
    );

    CREATE TABLE IF NOT EXISTS matrix_actor_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feishu_open_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
      bound_by INTEGER NOT NULL,
      bound_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(bound_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS matrix_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      thread_id TEXT NOT NULL DEFAULT '',
      filters_json TEXT NOT NULL,
      page INTEGER NOT NULL DEFAULT 1 CHECK(page >= 1),
      version INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(actor_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS matrix_work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL UNIQUE,
      stage TEXT NOT NULL DEFAULT 'selected' CHECK(stage IN ('selected','draft_pending','review_pending','suppressed')),
      owner_user_id INTEGER NOT NULL,
      current_summary TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      next_followup_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS matrix_selection_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_item_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY(work_item_id) REFERENCES matrix_work_items(id),
      FOREIGN KEY(actor_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_matrix_sessions_actor ON matrix_sessions(actor_user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_matrix_work_items_owner ON matrix_work_items(owner_user_id, stage, updated_at);
  `);

  const cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!cols.includes('priority')) {
    db.exec("ALTER TABLE orders ADD COLUMN priority INTEGER NOT NULL DEFAULT 0");
  }

  const ocols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!ocols.includes('assigned_shipping_worker')) db.exec("ALTER TABLE orders ADD COLUMN assigned_shipping_worker TEXT");
  if (!ocols.includes('order_qty')) db.exec("ALTER TABLE orders ADD COLUMN order_qty TEXT");
  if (!ocols.includes('order_spec')) db.exec("ALTER TABLE orders ADD COLUMN order_spec TEXT");
  if (!ocols.includes('legacy_openid')) db.exec("ALTER TABLE orders ADD COLUMN legacy_openid TEXT");
  if (!ocols.includes('legacy_order_state')) db.exec("ALTER TABLE orders ADD COLUMN legacy_order_state TEXT");
  if (!ocols.includes('legacy_source_key')) db.exec("ALTER TABLE orders ADD COLUMN legacy_source_key TEXT");
  if (!ocols.includes('legacy_json')) db.exec("ALTER TABLE orders ADD COLUMN legacy_json TEXT");
  if (!ocols.includes('start_time')) db.exec("ALTER TABLE orders ADD COLUMN start_time TEXT");
  if (!ocols.includes('order_image_url')) db.exec("ALTER TABLE orders ADD COLUMN order_image_url TEXT");
  if (!ocols.includes('order_image_thumb_url')) db.exec("ALTER TABLE orders ADD COLUMN order_image_thumb_url TEXT");
  if (!ocols.includes('order_image_uploaded_by')) db.exec("ALTER TABLE orders ADD COLUMN order_image_uploaded_by TEXT");
  if (!ocols.includes('processing_started_at')) db.exec("ALTER TABLE orders ADD COLUMN processing_started_at TEXT");
  if (!ocols.includes('processing_stage')) db.exec("ALTER TABLE orders ADD COLUMN processing_stage TEXT");
  db.exec("UPDATE orders SET start_time = COALESCE(start_time, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_legacy_source_key ON orders(legacy_source_key)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_start_time ON orders(start_time)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_processing ON orders(status, processing_started_at)");

  const ucols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!ucols.includes('full_name')) db.exec("ALTER TABLE users ADD COLUMN full_name TEXT");
  if (!ucols.includes('permissions_json')) db.exec("ALTER TABLE users ADD COLUMN permissions_json TEXT");

  const ccols = db.prepare("PRAGMA table_info(customers)").all().map(c => c.name);
  if (!ccols.includes('customer_code')) db.exec("ALTER TABLE customers ADD COLUMN customer_code TEXT");
  if (!ccols.includes('company_name')) db.exec("ALTER TABLE customers ADD COLUMN company_name TEXT");
  if (!ccols.includes('country')) db.exec("ALTER TABLE customers ADD COLUMN country TEXT");
  if (!ccols.includes('city')) db.exec("ALTER TABLE customers ADD COLUMN city TEXT");
  if (!ccols.includes('contact_person')) db.exec("ALTER TABLE customers ADD COLUMN contact_person TEXT");
  if (!ccols.includes('email')) db.exec("ALTER TABLE customers ADD COLUMN email TEXT");
  if (!ccols.includes('whatsapp')) db.exec("ALTER TABLE customers ADD COLUMN whatsapp TEXT");
  if (!ccols.includes('source_channel')) db.exec("ALTER TABLE customers ADD COLUMN source_channel TEXT");
  if (!ccols.includes('priority')) db.exec("ALTER TABLE customers ADD COLUMN priority TEXT DEFAULT 'C'");
  if (!ccols.includes('stage')) db.exec("ALTER TABLE customers ADD COLUMN stage TEXT DEFAULT 'new'");
  if (!ccols.includes('owner_id')) db.exec("ALTER TABLE customers ADD COLUMN owner_id INTEGER");
  if (!ccols.includes('latest_inquiry_id')) db.exec("ALTER TABLE customers ADD COLUMN latest_inquiry_id INTEGER");
  if (!ccols.includes('latest_quote_id')) db.exec("ALTER TABLE customers ADD COLUMN latest_quote_id INTEGER");
  if (!ccols.includes('latest_order_id')) db.exec("ALTER TABLE customers ADD COLUMN latest_order_id INTEGER");
  if (!ccols.includes('ai_summary')) db.exec("ALTER TABLE customers ADD COLUMN ai_summary TEXT");
  if (!ccols.includes('risk_notes')) db.exec("ALTER TABLE customers ADD COLUMN risk_notes TEXT");
  if (!ccols.includes('next_action')) db.exec("ALTER TABLE customers ADD COLUMN next_action TEXT");
  if (!ccols.includes('next_followup_at')) db.exec("ALTER TABLE customers ADD COLUMN next_followup_at TEXT");
  if (!ccols.includes('next_followup_purpose')) db.exec("ALTER TABLE customers ADD COLUMN next_followup_purpose TEXT");
  if (!ccols.includes('next_followup_channel')) db.exec("ALTER TABLE customers ADD COLUMN next_followup_channel TEXT");
  if (!ccols.includes('followup_priority')) db.exec("ALTER TABLE customers ADD COLUMN followup_priority TEXT");
  if (!ccols.includes('last_contact_at')) db.exec("ALTER TABLE customers ADD COLUMN last_contact_at TEXT");
  if (!ccols.includes('last_reply_at')) db.exec("ALTER TABLE customers ADD COLUMN last_reply_at TEXT");
  if (!ccols.includes('last_outbound_email_at')) db.exec("ALTER TABLE customers ADD COLUMN last_outbound_email_at TEXT");
  if (!ccols.includes('unreplied_since_at')) db.exec("ALTER TABLE customers ADD COLUMN unreplied_since_at TEXT");
  if (!ccols.includes('is_waiting_reply')) db.exec("ALTER TABLE customers ADD COLUMN is_waiting_reply INTEGER DEFAULT 0");
  if (!ccols.includes('is_invalid')) db.exec("ALTER TABLE customers ADD COLUMN is_invalid INTEGER DEFAULT 0");
  if (!ccols.includes('invalid_reason')) db.exec("ALTER TABLE customers ADD COLUMN invalid_reason TEXT");
  if (!ccols.includes('website')) db.exec("ALTER TABLE customers ADD COLUMN website TEXT");
  if (!ccols.includes('customer_type')) db.exec("ALTER TABLE customers ADD COLUMN customer_type TEXT");
  if (!ccols.includes('industry')) db.exec("ALTER TABLE customers ADD COLUMN industry TEXT");
  if (!ccols.includes('main_product')) db.exec("ALTER TABLE customers ADD COLUMN main_product TEXT");
  if (!ccols.includes('business_background')) db.exec("ALTER TABLE customers ADD COLUMN business_background TEXT");
  if (!ccols.includes('company_size_note')) db.exec("ALTER TABLE customers ADD COLUMN company_size_note TEXT");
  if (!ccols.includes('buyer_authenticity_note')) db.exec("ALTER TABLE customers ADD COLUMN buyer_authenticity_note TEXT");
  if (!ccols.includes('source_notes')) db.exec("ALTER TABLE customers ADD COLUMN source_notes TEXT");
  if (!ccols.includes('customer_summary')) db.exec("ALTER TABLE customers ADD COLUMN customer_summary TEXT");
  if (!ccols.includes('priority_reason')) db.exec("ALTER TABLE customers ADD COLUMN priority_reason TEXT");

  const crmMsgCols = db.prepare("PRAGMA table_info(crm_messages)").all().map(c => c.name);
  if (!crmMsgCols.includes('workflow_status')) db.exec("ALTER TABLE crm_messages ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'pending'");

  const fatherTaskCols = db.prepare("PRAGMA table_info(crm_father_review_tasks)").all().map(c => c.name);
  if (!fatherTaskCols.includes('sales_handled_at')) db.exec("ALTER TABLE crm_father_review_tasks ADD COLUMN sales_handled_at TEXT");
  if (!fatherTaskCols.includes('sales_handled_by')) db.exec("ALTER TABLE crm_father_review_tasks ADD COLUMN sales_handled_by TEXT");
  if (!fatherTaskCols.includes('sales_note')) db.exec("ALTER TABLE crm_father_review_tasks ADD COLUMN sales_note TEXT");

  if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'crm_reply_drafts'").get()) {
    const replyDraftCols = db.prepare("PRAGMA table_info(crm_reply_drafts)").all().map(c => c.name);
    [
      ['customer_id', 'INTEGER'],
      ['inquiry_id', 'INTEGER'],
      ['source_message_id', 'INTEGER'],
      ['source_interpretation_id', 'INTEGER'],
      ['father_task_id', 'INTEGER'],
      ['costing_draft_id', 'INTEGER'],
      ['source_type', 'TEXT'],
      ['reply_channel', 'TEXT'],
      ['recipient_contact', 'TEXT'],
      ['email_subject', 'TEXT'],
      ['draft_text_en', 'TEXT'],
      ['draft_text_cn', 'TEXT'],
      ['draft_summary_cn', 'TEXT'],
      ['generation_method', "TEXT NOT NULL DEFAULT 'rule_based'"],
      ['tone', "TEXT NOT NULL DEFAULT 'professional'"],
      ['status', "TEXT NOT NULL DEFAULT 'draft'"],
      ['risk_flags_json', 'TEXT'],
      ['missing_info_json', 'TEXT'],
      ['referenced_attachment_ids_json', 'TEXT'],
      ['crm_context_json', 'TEXT'],
      ['created_by', 'TEXT'],
      ['updated_by', 'TEXT'],
      ['approved_by', 'TEXT'],
      ['approved_at', 'TEXT'],
      ['created_at', 'TEXT'],
      ['updated_at', 'TEXT']
    ].forEach(([name, ddl]) => {
      if (!replyDraftCols.includes(name)) db.exec(`ALTER TABLE crm_reply_drafts ADD COLUMN ${name} ${ddl}`);
    });
  }

  const crmAttachmentCols = db.prepare("PRAGMA table_info(crm_message_attachments)").all().map(c => c.name);
  [
    ['message_id', 'INTEGER'],
    ['conversation_id', 'TEXT'],
    ['customer_id', 'INTEGER'],
    ['inquiry_id', 'INTEGER'],
    ['source_type', 'TEXT'],
    ['source_message_id', 'TEXT'],
    ['whatsapp_message_id', 'TEXT'],
    ['email_message_id', 'TEXT'],
    ['original_file_name', 'TEXT'],
    ['stored_file_name', 'TEXT'],
    ['mime_type', 'TEXT'],
    ['file_ext', 'TEXT'],
    ['file_size', 'INTEGER DEFAULT 0'],
    ['storage_path', 'TEXT'],
    ['public_url', 'TEXT'],
    ['preview_url', 'TEXT'],
    ['thumbnail_url', 'TEXT'],
    ['attachment_type', "TEXT DEFAULT 'other'"],
    ['media_order', 'INTEGER DEFAULT 1'],
    ['caption_text', 'TEXT'],
    ['ai_status', "TEXT DEFAULT 'skipped'"],
    ['ai_summary_cn', 'TEXT'],
    ['ai_summary_en', 'TEXT'],
    ['extracted_specs_json', 'TEXT'],
    ['risk_flags_json', 'TEXT'],
    ['raw_metadata_json', 'TEXT'],
    ['created_at', 'TEXT'],
    ['updated_at', 'TEXT']
  ].forEach(([name, ddl]) => {
    if (!crmAttachmentCols.includes(name)) db.exec(`ALTER TABLE crm_message_attachments ADD COLUMN ${name} ${ddl}`);
  });

  const foreignCostingDraftCols = db.prepare("PRAGMA table_info(foreign_costing_drafts)").all().map(c => c.name);
  [
    ['source_message_ids_json', 'TEXT'],
    ['attachment_ids_json', 'TEXT'],
    ['crm_spec_json', 'TEXT']
  ].forEach(([name, ddl]) => {
    if (!foreignCostingDraftCols.includes(name)) db.exec(`ALTER TABLE foreign_costing_drafts ADD COLUMN ${name} ${ddl}`);
  });

  db.exec("CREATE INDEX IF NOT EXISTS idx_crm_message_attachments_message ON crm_message_attachments(message_id, media_order, id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_crm_message_attachments_customer ON crm_message_attachments(customer_id, created_at DESC, id DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_crm_message_attachments_inquiry ON crm_message_attachments(inquiry_id, created_at DESC, id DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_crm_message_attachments_type ON crm_message_attachments(attachment_type, ai_status, created_at DESC)");

  const mpcols = db.prepare("PRAGMA table_info(material_prices)").all().map(c => c.name);
  if (!mpcols.includes('prop')) db.exec("ALTER TABLE material_prices ADD COLUMN prop REAL");

  const emcols = db.prepare("PRAGMA table_info(email_messages)").all().map(c => c.name);
  if (!emcols.includes('normalized_subject')) db.exec("ALTER TABLE email_messages ADD COLUMN normalized_subject TEXT");
  if (!emcols.includes('conversation_key')) db.exec("ALTER TABLE email_messages ADD COLUMN conversation_key TEXT");
  if (!emcols.includes('email_domain')) db.exec("ALTER TABLE email_messages ADD COLUMN email_domain TEXT");
  if (!emcols.includes('contact_email')) db.exec("ALTER TABLE email_messages ADD COLUMN contact_email TEXT");
  if (!emcols.includes('contact_name')) db.exec("ALTER TABLE email_messages ADD COLUMN contact_name TEXT");
  if (!emcols.includes('noise_level')) db.exec("ALTER TABLE email_messages ADD COLUMN noise_level TEXT DEFAULT 'low'");
  if (!emcols.includes('business_relevance')) db.exec("ALTER TABLE email_messages ADD COLUMN business_relevance TEXT DEFAULT 'low'");
  if (!emcols.includes('detected_signals_json')) db.exec("ALTER TABLE email_messages ADD COLUMN detected_signals_json TEXT");
  if (!emcols.includes('parser_hints_json')) db.exec("ALTER TABLE email_messages ADD COLUMN parser_hints_json TEXT");
  if (!emcols.includes('quote_detected')) db.exec("ALTER TABLE email_messages ADD COLUMN quote_detected INTEGER DEFAULT 0");
  if (!emcols.includes('inquiry_detected')) db.exec("ALTER TABLE email_messages ADD COLUMN inquiry_detected INTEGER DEFAULT 0");
  if (!emcols.includes('customer_detected')) db.exec("ALTER TABLE email_messages ADD COLUMN customer_detected INTEGER DEFAULT 0");
  if (!emcols.includes('parsed_at')) db.exec("ALTER TABLE email_messages ADD COLUMN parsed_at TEXT");

  const icols = db.prepare("PRAGMA table_info(inquiries)").all().map(c => c.name);
  if (!icols.includes('quote_readiness_status')) db.exec("ALTER TABLE inquiries ADD COLUMN quote_readiness_status TEXT");
  if (!icols.includes('quote_readiness_score')) db.exec("ALTER TABLE inquiries ADD COLUMN quote_readiness_score INTEGER DEFAULT 0");
  if (!icols.includes('quote_readiness_color')) db.exec("ALTER TABLE inquiries ADD COLUMN quote_readiness_color TEXT");
  if (!icols.includes('quote_missing_fields_json')) db.exec("ALTER TABLE inquiries ADD COLUMN quote_missing_fields_json TEXT");
  if (!icols.includes('quote_readiness_warnings_json')) db.exec("ALTER TABLE inquiries ADD COLUMN quote_readiness_warnings_json TEXT");
  if (!icols.includes('quote_next_action')) db.exec("ALTER TABLE inquiries ADD COLUMN quote_next_action TEXT");
  if (!icols.includes('quote_readiness_updated_at')) db.exec("ALTER TABLE inquiries ADD COLUMN quote_readiness_updated_at TEXT");

  const cscols = db.prepare("PRAGMA table_info(cost_snapshots)").all().map(c => c.name);
  if (!cscols.includes('customer_id')) db.exec("ALTER TABLE cost_snapshots ADD COLUMN customer_id INTEGER");
  if (!cscols.includes('inquiry_id')) db.exec("ALTER TABLE cost_snapshots ADD COLUMN inquiry_id INTEGER");
  if (!cscols.includes('specification_id')) db.exec("ALTER TABLE cost_snapshots ADD COLUMN specification_id INTEGER");
  if (!cscols.includes('costing_request_id')) db.exec("ALTER TABLE cost_snapshots ADD COLUMN costing_request_id INTEGER");
  if (!cscols.includes('version_no')) db.exec("ALTER TABLE cost_snapshots ADD COLUMN version_no INTEGER DEFAULT 1");
  if (!cscols.includes('is_current')) db.exec("ALTER TABLE cost_snapshots ADD COLUMN is_current INTEGER DEFAULT 1");
  if (!cscols.includes('crm_quote_status')) db.exec("ALTER TABLE cost_snapshots ADD COLUMN crm_quote_status TEXT");
  if (!cscols.includes('crm_notes')) db.exec("ALTER TABLE cost_snapshots ADD COLUMN crm_notes TEXT");

  db.exec("CREATE INDEX IF NOT EXISTS idx_cost_snapshots_user_kind ON cost_snapshots(user_name, kind, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cost_snapshots_crm ON cost_snapshots(costing_request_id, inquiry_id, specification_id, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customers_salesperson ON customers(salesperson_id, active, name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customers_crm_stage ON customers(stage, priority, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customers_crm_priority ON customers(priority, stage, next_followup_at, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customers_crm_followup ON customers(next_followup_at, followup_priority, is_waiting_reply, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customers_whatsapp ON customers(whatsapp)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customers_name_lookup ON customers(company_name, name, contact_person)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_communication_logs_customer ON communication_logs(customer_id, received_at DESC, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_communication_logs_inquiry ON communication_logs(inquiry_id, received_at DESC, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_inquiries_customer ON inquiries(customer_id, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status, priority, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_inquiry_specifications_inquiry ON inquiry_specifications(inquiry_id, version_no DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_specification_layers_spec ON specification_layers(specification_id, layer_order)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_costing_requests_inquiry ON costing_requests(inquiry_id, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_costing_requests_assigned ON costing_requests(assigned_to_user_id, assigned_to, status, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cost_sheet_lines_request ON cost_sheet_lines(costing_request_id, specification_id, id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_freight_quotes_inquiry ON freight_quotes(inquiry_id, is_current DESC, version_no DESC, id DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_freight_quotes_assigned ON freight_quotes(assigned_to_user_id, assigned_to, status, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_freight_quotes_destination ON freight_quotes(destination_country, destination_port, shipping_mode, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_customer_research_notes_customer ON customer_research_notes(customer_id, status, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_sync_runs_created ON email_sync_runs(created_at DESC, status)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_message_id_unique ON email_messages(message_id) WHERE message_id IS NOT NULL AND message_id != ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_mailbox_folder_uid ON email_messages(mailbox, folder, message_uid)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_messages_customer ON email_messages(matched_customer_id, received_at DESC, id DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(processing_status, direction, received_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_messages_inquiry ON email_messages(matched_inquiry_id, received_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_messages_conversation ON email_messages(conversation_key, received_at DESC, id DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_messages_quote ON email_messages(quote_detected, inquiry_detected, processing_status, received_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_messages_relevance ON email_messages(business_relevance, noise_level, received_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_ai_runs_status ON email_ai_analysis_runs(status, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_email_ai_runs_scope ON email_ai_analysis_runs(scope_type, scope_key, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_crm_import_suggestions_source ON crm_import_suggestions(source_type, source_id, status, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_crm_import_suggestions_match ON crm_import_suggestions(matched_customer_id, matched_inquiry_id, status, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_work_orders_salesperson ON work_orders(salesperson_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders(customer_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_work_orders_order_id ON work_orders(order_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cost_email_logs_user ON cost_email_logs(user_name, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_stage_logs_order ON order_stage_logs(order_id, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_stage_logs_stage ON order_stage_logs(stage, source, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_subscriptions_user ON order_subscriptions(user_name, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_subscriptions_order ON order_subscriptions(order_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_stock_screen_date ON stock_screen_results(trade_date, score DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_stock_watchlist_active ON stock_watchlist(active, pinned DESC, updated_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_stock_watchlist_analysis_day ON stock_watchlist_analysis(trade_date, signal DESC)");
  const scols = db.prepare("PRAGMA table_info(stock_screen_results)").all().map(c => c.name);
  if (!scols.includes('board')) db.exec("ALTER TABLE stock_screen_results ADD COLUMN board TEXT");
  const swcols = db.prepare("PRAGMA table_info(stock_watchlist)").all().map(c => c.name);
  if (!swcols.includes('pinned')) db.exec("ALTER TABLE stock_watchlist ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  const sacols = db.prepare("PRAGMA table_info(stock_watchlist_analysis)").all().map(c => c.name);
  if (!sacols.includes('buy_index')) db.exec("ALTER TABLE stock_watchlist_analysis ADD COLUMN buy_index REAL");
  const mcols = db.prepare("PRAGMA table_info(menu_items)").all().map(c => c.name);
  if (!mcols.includes('disabled')) db.exec("ALTER TABLE menu_items ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE INDEX IF NOT EXISTS idx_menu_items_creator ON menu_items(created_by, type, updated_at DESC)");
  const wcols = db.prepare("PRAGMA table_info(work_orders)").all().map(c => c.name);
  if (!wcols.includes('order_image_url')) db.exec("ALTER TABLE work_orders ADD COLUMN order_image_url TEXT");

  const qcols = db.prepare("PRAGMA table_info(quote_sheets)").all().map(c => c.name);
  if (!qcols.includes('input_json')) db.exec("ALTER TABLE quote_sheets ADD COLUMN input_json TEXT");
  if (!qcols.includes('calc_json')) db.exec("ALTER TABLE quote_sheets ADD COLUMN calc_json TEXT");

  const slcols = db.prepare("PRAGMA table_info(order_stage_logs)").all().map(c => c.name);
  if (!slcols.includes('event_type')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN event_type TEXT NOT NULL DEFAULT 'COMPLETE'");
  if (!slcols.includes('rolled_back')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN rolled_back INTEGER NOT NULL DEFAULT 0");
  if (!slcols.includes('rollback_of_log_id')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN rollback_of_log_id INTEGER");
  if (!slcols.includes('rollback_reason')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN rollback_reason TEXT");
  if (!slcols.includes('extra_json')) db.exec("ALTER TABLE order_stage_logs ADD COLUMN extra_json TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_stage_logs_event ON order_stage_logs(order_id, stage, event_type, rolled_back, id DESC)");

  const admin = db.prepare("SELECT id, password FROM users WHERE username = ?").get('admin');
  if (!admin) {
    const pwd = crypto.randomBytes(12).toString('hex');
    const hash = bcrypt.hashSync(pwd, 10);
    db.prepare("INSERT INTO users (username, password, role, status, created_at, approved_at) VALUES (?, ?, 'super_admin', 'active', ?, ?)")
      .run('admin', hash, now(), now());
    console.log(`[db] Created default admin account. username=admin password=${pwd}`);
    console.log('[db] CHANGE THIS PASSWORD immediately after first login.');
  } else if (admin.password === 'admin') {
    const pwd = crypto.randomBytes(12).toString('hex');
    const hash = bcrypt.hashSync(pwd, 10);
    db.prepare("UPDATE users SET password = ? WHERE username = 'admin'").run(hash);
    console.log(`[db] DEFAULT ADMIN PASSWORD WAS UNSAFE - regenerated. username=admin password=${pwd}`);
    console.log('[db] CHANGE THIS PASSWORD immediately.');
  }

  const spUpsert = db.prepare(`
    INSERT INTO salespersons (name, code, active, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at
  `);
  const salesUsers = db.prepare("SELECT username FROM users WHERE role IN ('super_admin','manager','ai_sales')").all();
  const tsSales = now();
  salesUsers.forEach((u, idx) => {
    const code = `YW${String(idx + 1).padStart(2, '0')}`;
    spUpsert.run(u.username, code, tsSales, tsSales);
  });

  const defaults = {
    PET: { prop: 1.38, price: 9800 },
    BOPP: { prop: 0.91, price: 9200 },
    CPP: { prop: 0.90, price: 9300 },
    PE: { prop: 0.92, price: 9000 },
    NY: { prop: 1.14, price: 12500 },
    AL: { prop: 2.70, price: 18000 },
    MOPP: { prop: 0.90, price: 11000 },
    VMCPP: { prop: 1.05, price: 13500 },
    VMPET: { prop: 1.40, price: 14000 },
    '纸': { prop: 0.80, price: 7600 }
  };
  const upsert = db.prepare(`
    INSERT INTO material_prices (code, prop, price, updated_by, updated_at)
    VALUES (?, ?, ?, 'system', ?)
    ON CONFLICT(code) DO UPDATE SET
      prop = COALESCE(material_prices.prop, excluded.prop),
      price = COALESCE(material_prices.price, excluded.price)
  `);
  const ts = now();
  Object.entries(defaults).forEach(([code, cfg]) => upsert.run(code, cfg.prop, cfg.price, ts));

  const aliasTs = now();
  const materialAliasSeed = db.prepare(`
    INSERT OR IGNORE INTO material_aliases (
      raw_name,
      normalized_material,
      display_name_cn,
      density,
      price,
      price_unit,
      confidence,
      needs_confirm,
      note,
      updated_by,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  [
    ['LDPE', 'PE', '低密度聚乙烯', null, null, null, 'medium', 1, null, 'system', aliasTs],
    ['LDPE Tr.', 'PE/透明PE', '透明低密度聚乙烯', null, null, null, 'medium', 1, null, 'system', aliasTs],
    ['LLDPE', 'PE/LLDPE', '线性低密度聚乙烯', null, null, null, 'medium', 1, null, 'system', aliasTs],
    ['PE', 'PE', '聚乙烯', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['CPE', 'CPE', '流延聚乙烯', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['CPP', 'CPP', '流延聚丙烯', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['RCPP', 'CPP/RCPP', '镀铝蒸煮CPP', null, null, null, 'medium', 1, null, 'system', aliasTs],
    ['PET', 'PET', '聚对苯二甲酸乙二醇酯', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['BOPP', 'BOPP', '双向拉伸聚丙烯', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['MOPP', 'MOPP', '单向拉伸聚丙烯', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['MBOPP', 'MBOPP', '镀铝双向拉伸聚丙烯', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['VMPET', 'VMPET', '镀铝PET', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['MET PET', 'VMPET', '镀铝PET', null, null, null, 'medium', 1, null, 'system', aliasTs],
    ['VMCPP', 'VMCPP', '镀铝CPP', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['AL', 'AL', '铝箔', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['Aluminum foil', 'AL', '铝箔', null, null, null, 'medium', 0, null, 'system', aliasTs],
    ['ALOX', '氧化铝/ALOX', '氧化铝涂层', null, null, null, 'medium', 1, null, 'system', aliasTs],
    ['Kraft', '白牛皮纸/牛皮纸', '牛皮纸', null, null, null, 'medium', 1, null, 'system', aliasTs],
    ['Matt varnish', 'surface_finish', '哑光光油', null, null, null, 'medium', 1, null, 'system', aliasTs]
  ].forEach(row => materialAliasSeed.run(...row));

  const menuCount = db.prepare('SELECT count(*) AS c FROM menu_items').get().c;
  if (!menuCount) {
    const insMenu = db.prepare('INSERT INTO menu_items (name, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const dishes = [
      ['卤鹅拼盘','肉菜'],['蚝烙','肉菜'],['潮汕牛肉丸','肉菜'],['普宁豆腐','菜'],['菜脯煎蛋','菜'],
      ['炒芥蓝','菜'],['蒜蓉空心菜','菜'],['苦瓜炒蛋','菜'],['潮汕咸菜炒肉末','肉菜'],['萝卜干炒饭豆','菜'],
      ['老菜脯排骨汤','汤'],['紫菜肉丸汤','汤'],['冬瓜薏米排骨汤','汤'],['咸菜豆腐汤','汤'],['苦瓜黄豆汤','汤']
    ];
    const t = now();
    dishes.forEach(([name, type]) => insMenu.run(name, type, 'system', t, t));
  }
}

function now() {
  // 全系统统一使用北京时间（Asia/Shanghai）字符串
  // 形如：2026-02-28 18:30:00
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function audit({ role, userName, action, resourceType, resourceId = '', detail = '' }) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (role, user_name, action, resource_type, resource_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(role, userName, action, resourceType, String(resourceId), detail, now());
}

module.exports = { db, initDb, now, audit };
