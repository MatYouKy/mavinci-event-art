-- Przywrócenie uprawnień bazy po przeniesieniu projektu do Frankfurtu (10.11.2026) — 2026-11-17.
--
-- CO I DLACZEGO
-- Przy przeniesieniu bazy (nowy projekt wjxnyvcxhhxjytfwpwvu) wszystkie tabele, widoki, sekwencje i funkcje w public
-- dostały pełne uprawnienia ról anon, authenticated i service_role. Przepadło utwardzenie z 20261101190000_security_p0
-- i późniejszych migracji: publiczny klucz strony (anon) mógł wywołać 999 z 1013 funkcji SECURITY DEFINER (w starym
-- projekcie 14), zalogowany czytał sekrety KSeF (token, klucz i hasło certyfikatu), a tabele „tylko serwer” i „tylko
-- odczyt” (rozliczenia, płace, wyciągi, deklaracje, sprzedawcy…) znów przyjmowały zapis z API. Wiersze nadal chroniły
-- polityki RLS, ale funkcje SECURITY DEFINER je omijają, a rozliczenia i płace miały być zmieniane wyłącznie funkcjami.
-- Uprawnienia kolumn i schematów przeniosły się bez zmian; nowe obiekty z migracji po przeniesieniu mają swoje GRANT-y.
--
-- WZORZEC: stary projekt (fuuljhhuhfojtmmfmskq, tylko do odczytu), stan z 17.11.2026 — listy poniżej są z niego
-- wygenerowane. Migracja niczego nie dodaje ponad stan sprzed przeniesienia; odbiera tylko nadmiarowe uprawnienia:
--  1. Domyślne uprawnienia: nowe funkcje w public bez EXECUTE dla PUBLIC i anon (jak po security_p0).
--  2. Funkcje w public:
--     • 43 funkcje dla strony i linków publicznych (motyw strony, analityka, Mavinci View / Online, oferta i formularz
--       sprzedawcy…) — anon, authenticated, service_role jak dotąd;
--     • 253 funkcje „tylko serwer” (Edge Functions, pg_cron, triggery) — tylko service_role;
--     • 19 funkcji tylko dla właściciela (triggery i pomocnicze) — bez anon, authenticated i service_role;
--     • 5 funkcji prowizji właściciela — tylko authenticated;
--     • pozostałe — bez anon (zalogowani i service_role bez zmian). Funkcje z EXECUTE dla PUBLIC (400 funkcji
--       pomocniczych SECURITY INVOKER, w tym rozszerzenie btree_gist) — bez zmian, tak jak w starym projekcie.
--  3. 120 tabel (3 tabele mac_sync_* usunięte po przeniesieniu są pomijane), 6 widoków i 1 sekwencja: dokładnie
--     uprawnienia ze starego projektu (pozostałe tabele mają pełne uprawnienia ról API w obu projektach — chroni je
--     RLS). Uprawnienia kolumn (ksef_credentials, marketing_integrations, notification_recipients, personnel_people)
--     są zapamiętywane i nadawane ponownie, bo odebranie uprawnienia tabeli odbiera też to samo uprawnienie kolumn.
--  4. Kontrola końcowa — migracja zatrzymuje się, jeśli cokolwiek nie zgadza się ze wzorcem.
--
-- KOGO DOTYCZY: anon (strona WWW, linki publiczne) — tylko funkcje i tabele z listy wyjątków jak przed 10.11;
-- zalogowani (CRM, aplikacje, portal sprzedawcy) — jak przed 10.11 (zapis rozliczeń, płac i deklaracji przez funkcje).
-- Kod pisany po 10.11 nie zapisuje kluczem użytkownika do tabel, które ta migracja ogranicza (sprawdzone 17.11.2026:
-- zapis tylko kluczem serwera albo do kolumn z własnym uprawnieniem, np. notification_recipients.is_read).
-- Nie zmienia polityk RLS, funkcji ani danych. Plik można uruchomić ponownie (idempotentny), w całości w SQL Editorze.
BEGIN;

-- 1. Domyślne uprawnienia funkcji -------------------------------------------------------------------------------------
DO $$
DECLARE v_role name;
BEGIN
  FOR v_role IN
    SELECT DISTINCT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.pronamespace = 'public'::regnamespace AND pg_has_role(current_user, r.oid, 'MEMBER')
    UNION SELECT current_user::name
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', v_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon', v_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role', v_role);
  END LOOP;
END $$;

-- 2. Funkcje (z kontrolą) -------------------------------------------------------------------------------------------
DO $$
DECLARE
  -- Strona WWW i linki publiczne: anon, authenticated, service_role.
  v_anon_list text[] := ARRAY[
    'accept_shared_seller_offer(text, text, text, text, boolean)',
    'approve_inquiry_summary(uuid, uuid, integer)',
    'assign_event_employee_to_phases(uuid, uuid, uuid[], text)',
    'assign_event_employee_to_phases_with_conflict_decision(uuid, uuid, uuid[], text, boolean, text)',
    'assign_event_vehicle_to_phases(uuid, uuid, uuid[], uuid, integer, integer, text, text)',
    'bank_transaction_contains_account(text, text, text, text, text)',
    'get_email_conversation(text, uuid, boolean)',
    'get_email_conversation_preview(text, uuid)',
    'get_event_operational_states(uuid[])',
    'get_inquiry_approved_summary(uuid)',
    'get_inquiry_correspondence(uuid)',
    'get_inquiry_correspondence_live(uuid)',
    'get_public_brand_theme()',
    'get_seller_inquiry_form(text)',
    'get_shared_seller_offer(text)',
    'guard_offer_recommendation_products()',
    'guard_personnel_salary_net_amount()',
    'is_sensitive_event_document(text)',
    'kit_component_usable_stock(uuid, uuid)',
    'link_inquiry_email(uuid, text, uuid, boolean, boolean)',
    'mavinci_online_can_receive(text)',
    'mavinci_online_join(text, text, text)',
    'mavinci_online_press(text, text, integer)',
    'mavinci_online_state(text)',
    'mavinci_view_device_claim_command(text, text, uuid)',
    'mavinci_view_device_finish_command(text, text, uuid, jsonb, text)',
    'mavinci_view_device_pending_commands(text, text)',
    'mavinci_view_device_sync(text, text, text, text, text, jsonb, jsonb, boolean)',
    'offer_item_planned_cost_net(numeric, numeric, jsonb, jsonb)',
    'offer_logistics_estimate_total(jsonb)',
    'package_cost_line_net(jsonb)',
    'package_staff_cost_items(jsonb)',
    'product_staff_cost_lines(uuid, uuid)',
    'reorder_offer_items(uuid, uuid[], uuid[])',
    'resolve_offer_line_equipment(uuid, uuid, jsonb)',
    'save_equipment_kit_checked(uuid, jsonb, jsonb)',
    'save_offer_packages_and_logistics(uuid, bigint, jsonb, boolean, jsonb)',
    'set_event_payment_plan(uuid, text, numeric, numeric, date, date)',
    'set_event_payment_plan(uuid, text, numeric, numeric, date, date, integer)',
    'set_quiz_gallery_primary(uuid)',
    'staff_cost_snapshot_total(jsonb)',
    'submit_public_seller_inquiry(text, uuid, jsonb)',
    'update_page_analytics_duration(uuid, text, integer)'];
  -- Tylko serwer (Edge Functions, pg_cron, triggery, inne funkcje SECURITY DEFINER): service_role.
  v_service_list text[] := ARRAY[
    'accept_own_driver_assignment()',
    'accept_own_event_phase_assignment()',
    'accept_own_event_team_assignment()',
    'add_email_account(uuid, text, text, text, text, integer, text, text, boolean, text, integer, text, text, boolean, text, boolean, boolean)',
    'add_event_author_to_team()',
    'apply_invoice_event_company(uuid, boolean)',
    'assign_partner_order_reference()',
    'assign_seller_demo_document_employee()',
    'assign_seller_demo_session_employee()',
    'begin_ksef_send_atomic(uuid, uuid)',
    'calculate_product_staff_costs(uuid)',
    'cancel_event_contract_verified(uuid, uuid, uuid, text)',
    'chat_unread_totals(uuid[])',
    'check_absence_overlap(uuid, timestamp with time zone, timestamp with time zone, uuid)',
    'check_all_employee_overtime()',
    'check_and_notify_invoice_payments()',
    'check_event_skill_requirements(uuid)',
    'check_fleet_notifications()',
    'check_unreturned_vehicles()',
    'claim_due_scheduled_emails(integer)',
    'claim_email_ai_qualification(integer)',
    'claim_mailing_campaign_batch(integer)',
    'claim_seller_demo_pdf(uuid, uuid)',
    'claim_seller_offer_email(uuid, uuid, uuid)',
    'clear_changed_event_travel_plans()',
    'commit_mac_sync_file(uuid, uuid, text, text, text, bigint, text, integer)',
    'complete_seller_offer_email(uuid)',
    'confirm_equipment_reservation(uuid)',
    'create_due_event_invoice_tasks()',
    'create_employee_overtime_alert(uuid, date)',
    'create_event_operational_notification(uuid, text, text, text, text, text, jsonb)',
    'create_fleet_compliance_notification(uuid, text, uuid, date, text, text, text, text)',
    'create_product_from_subcontractor_service(uuid, uuid)',
    'crm_create_ai_email_inquiry(uuid, text, text, jsonb, uuid, integer)',
    'default_employee_time_rate()',
    'delete_employee_hard(uuid)',
    'delete_offer_with_cleanup(uuid)',
    'employee_can_prepare_event(uuid, uuid)',
    'employee_time_report_signature(uuid, timestamp with time zone)',
    'employee_work_minutes_for_day(uuid, date)',
    'employees_public_by_ids(uuid[])',
    'enforce_event_author_membership()',
    'enqueue_crm_business_notification(text, text, text, text, text, text, text, text, uuid, jsonb, uuid[])',
    'ensure_contracts_folder(uuid)',
    'ensure_event_workflow_instance(uuid)',
    'ensure_local_sales_ksef(uuid)',
    'ensure_local_sales_ksef_after_sync()',
    'ensure_seller_offer_event(uuid)',
    'event_assignment_is_author(uuid, uuid)',
    'event_assignment_is_own(uuid, uuid)',
    'event_invoice_lifecycle_state(uuid)',
    'event_invoice_source_company_matches(uuid, text, uuid, uuid)',
    'event_payment_invoice_evidence(uuid)',
    'finalize_mailing_campaign_batch(uuid)',
    'find_employees_with_skills(uuid)',
    'finish_email_trash_operation(text, uuid, uuid, jsonb)',
    'finish_ksef_send_attempt_failure_atomic(uuid, text, boolean, uuid)',
    'flush_crm_business_notification_outbox()',
    'forward_local_sales_payment()',
    'get_employee_conflicts(uuid, timestamp with time zone, timestamp with time zone)',
    'get_employee_email_accounts(uuid)',
    'get_employee_phase_conflicts(uuid, timestamp with time zone, timestamp with time zone, uuid)',
    'get_employee_timeline(uuid[], timestamp with time zone, timestamp with time zone)',
    'get_event_cash_summary(uuid)',
    'get_event_invoices(uuid)',
    'get_event_preflight_core(uuid)',
    'get_event_required_skills(uuid)',
    'get_or_create_documents_folder(uuid, uuid)',
    'get_organization_invoices(uuid)',
    'get_shared_seller_offer_asset(text, text)',
    'get_shared_seller_offer_document(text)',
    'get_vehicle_cost_report(uuid, date, date)',
    'grant_linked_personnel_crm_time_access()',
    'grant_personnel_crm_time_access()',
    'guard_cable_category_hierarchy()',
    'guard_campaign_personal_demo_brochure()',
    'guard_inquiry_event_link()',
    'guard_inquiry_team_scope()',
    'guard_mailbox_notification_recipient()',
    'guard_offer_send_approval()',
    'guard_pending_seller_event()',
    'guard_personnel_contract()',
    'guard_personnel_questionnaire()',
    'guard_personnel_questionnaire_document()',
    'guard_personnel_questionnaire_settlement()',
    'guard_personnel_settlement_payment()',
    'guard_personnel_work()',
    'guard_repeated_assignment_response()',
    'guard_sales_invoice_pdf_reference()',
    'guard_sales_invoice_relation()',
    'guard_sales_invoice_write()',
    'guard_tender_assignment()',
    'has_email_account_access(uuid, uuid)',
    'import_costs_from_accepted_offer(uuid, uuid)',
    'inquiry_handoff_target_allowed(uuid, uuid)',
    'inquiry_has_work(uuid)',
    'inquiry_team_candidate(uuid)',
    'insert_meeting_occurrence(jsonb, jsonb, uuid, uuid, integer, integer)',
    'invoice_confirmed_received_amount(uuid)',
    'invoke_ai_email_qualification()',
    'invoke_daily_ksef_sync()',
    'invoke_marketing_campaign_worker()',
    'invoke_marketing_sync()',
    'invoke_scheduled_email_worker()',
    'invoke_scheduled_tender_scan()',
    'invoke_subcontractor_reminder_worker()',
    'linked_sales_ksef(uuid)',
    'mailbox_notification_allowed(uuid, uuid)',
    'mark_bank_ai_reports_stale_for_statement_period(uuid, integer, integer)',
    'materialize_meeting_series(uuid)',
    'mavinci_online_new_code()',
    'mavinci_online_notify_join()',
    'mavinci_online_notify_press()',
    'mirror_local_sales_bank_match()',
    'normalize_personnel_time_evidence()',
    'normalize_seller_event_days(jsonb)',
    'notify_driver_invitation()',
    'notify_event_operation(uuid, text, text, text, text, uuid)',
    'notify_finance_on_offer_accepted()',
    'notify_new_received_email()',
    'notify_overdue_event_workflows()',
    'notify_realization_responsibility()',
    'notify_seller_accepted_offer()',
    'notify_seller_confirmed_event()',
    'notify_seller_demo_generation()',
    'notify_seller_linked_realization()',
    'notify_seller_offer_workflow(uuid, uuid, boolean)',
    'notify_seller_realization_acceptance(uuid)',
    'notify_seller_review_decision()',
    'notify_subcontractor_guidelines_response()',
    'notify_warehouse_ready()',
    'offer_guardrail_evaluate_row(offers)',
    'offer_guardrail_evaluation(uuid)',
    'offer_sales_owner_user_ids(uuid)',
    'offer_send_guardrail(uuid, uuid)',
    'override_event_equipment(uuid, integer)',
    'persist_ksef_send_result_atomic(uuid, text, text, timestamp with time zone, text, boolean, uuid)',
    'personnel_contract_rules()',
    'personnel_payment_rules()',
    'personnel_questionnaire_date(text, text)',
    'personnel_questionnaire_settings(personnel_contracts)',
    'personnel_rate_at(uuid, date)',
    'personnel_template_version()',
    'pickup_vehicle(uuid, uuid)',
    'prepare_saved_brochure_delivery(uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, uuid)',
    'process_crm_system_health_alerts()',
    'process_due_crm_call_followups()',
    'process_due_inquiry_followups()',
    'process_event_operational_alerts()',
    'process_event_operational_alerts_in_delivery_window()',
    'process_meeting_reminders()',
    'process_offer_followup_reminders()',
    'process_public_holiday_responses()',
    'process_tender_deadline_reminders()',
    'project_invoice_to_event_payment()',
    'project_proforma_advance_payment_state()',
    'project_sales_ksef_payment(uuid)',
    'project_sales_payment_after_ledger()',
    'protect_employee_finance_access_scope()',
    'protect_offer_approval_columns()',
    'publish_calculation_pdf(uuid, integer, text)',
    'recalculate_bank_transaction_match_state(uuid)',
    'recalculate_external_invoice_bank_payment(uuid)',
    'recalculate_local_invoice_bank_payment(uuid)',
    'receive_inquiry_webhook(uuid, jsonb)',
    'reconcile_local_invoice_with_ksef_atomic(uuid, text)',
    'record_inquiry_delivery(uuid, text, text)',
    'record_offer_english_document(uuid, bigint, text, text, integer, jsonb)',
    'record_sales_brochure_generation(uuid, text, text, bigint, jsonb, uuid)',
    'record_sales_delivery(text, uuid, text, text, text)',
    'record_seller_demo_visit(uuid, uuid, uuid, text)',
    'record_seller_offer_document(uuid, uuid, text, text, text, uuid)',
    'refresh_event_invoice_lifecycle_after_change()',
    'refresh_event_mavinci_live_modules(uuid)',
    'refresh_event_workflow_after_related_change()',
    'refresh_invoice_event_company()',
    'refresh_invoice_settlement_allocations(uuid, uuid)',
    'refresh_meeting_series()',
    'refresh_payment_plan_after_insert()',
    'refresh_proforma_advance_payment_state()',
    'refresh_vehicle_compliance()',
    'refresh_workflow_after_partner_arrangement()',
    'remove_event_equipment_from_offer(uuid)',
    'replace_wedding_card_people(uuid, jsonb)',
    'require_dedicated_driving_license_record()',
    'require_offer_revision_reason()',
    'require_paid_advance_for_settlement()',
    'reserve_equipment_for_event(uuid)',
    'reserve_equipment_from_offer(uuid)',
    'reserve_invoice_number_atomic(text, uuid)',
    'reset_offer_approval_on_insert()',
    'reset_offer_followups_on_send()',
    'reset_room_guidelines()',
    'reset_tender_reminders_on_deadline()',
    'resolve_conflict_with_external_rental(uuid, text)',
    'resolve_conflict_with_substitution(uuid, uuid, uuid)',
    'resolve_seller_offer_branding(uuid, uuid)',
    'resolve_seller_offer_branding_for_organization(uuid, uuid, uuid)',
    'resolve_seller_product_price(uuid, uuid, uuid, uuid)',
    'restore_event_equipment_from_offer(uuid, text, uuid)',
    'restore_event_equipment_to_offer(uuid)',
    'retry_uncertain_brochure_delivery(uuid, uuid, boolean)',
    'return_vehicle(uuid, uuid)',
    'return_vehicle(uuid, uuid, integer, timestamp with time zone)',
    'run_event_steps_maintenance()',
    'sales_actor_can_manage(text, uuid, uuid)',
    'save_offer_conflicts(uuid, jsonb)',
    'save_seller_portal_branding(jsonb)',
    'seed_statutory_holidays(integer)',
    'seller_commissions_visible(uuid, uuid)',
    'seller_default_offer_organization(uuid)',
    'seller_offer_notification_recipients(uuid, boolean)',
    'seller_offer_organization_for_save(uuid, uuid, jsonb)',
    'seller_offer_visual_identity(jsonb)',
    'seller_partner_hotel_ids(uuid)',
    'seller_partner_manager_id(uuid, uuid)',
    'seller_partner_organization_ids(uuid)',
    'seller_realization_step_context(uuid, text)',
    'set_default_customer_owner()',
    'set_personal_synced_task_completion(uuid, uuid, boolean, timestamp with time zone)',
    'snapshot_offer_draft_revision(uuid)',
    'snapshot_seller_offer_identity()',
    'sync_billing_commissions_after_contact()',
    'sync_billing_commissions_after_event()',
    'sync_billing_commissions_after_offer()',
    'sync_contract_employee_address()',
    'sync_event_billing_seller_commissions(uuid)',
    'sync_event_equipment_from_offer(uuid)',
    'sync_event_invoice_lifecycle(uuid)',
    'sync_event_payment_plan_invoices(uuid)',
    'sync_event_return_phases(uuid)',
    'sync_event_steps(uuid)',
    'sync_event_vehicle_to_phases(uuid)',
    'sync_event_workflow_tasks_internal(uuid)',
    'sync_invoice_status_on_event_completion()',
    'sync_personnel_employee()',
    'sync_seller_review_notification_read()',
    'sync_tender_status_from_inquiry()',
    'trigger_sync_event_return_phases()',
    'unreserve_equipment_from_offer(uuid)',
    'update_monthly_summary(integer, integer, uuid)',
    'update_overdue_invoices()',
    'user_has_email_account_access(uuid, uuid)',
    'validate_event_referring_sales_partner()',
    'validate_event_rooms()',
    'validate_event_vehicle_driver()',
    'validate_location_rooms()',
    'validate_personnel_time_evidence_document()',
    'validate_phase_vehicle_driver()',
    'validate_seller_identity_assets(jsonb, uuid, uuid, uuid, uuid)',
    'validate_seller_realization_step(text, jsonb, boolean)',
    'vehicle_driver_problem(uuid, uuid, timestamp with time zone, timestamp with time zone, uuid, uuid, boolean)',
    'verify_scheduled_email_worker_secret(text)'];
  -- Tylko właściciel (triggery i funkcje pomocnicze wołane z innych funkcji SECURITY DEFINER).
  v_owner_list text[] := ARRAY[
    'build_invoice_ksef_recipient_snapshot(invoices)',
    'capture_invoice_ksef_recipient_snapshot()',
    'create_inquiry_from_contact_message()',
    'create_inquiry_from_inbound_event()',
    'ensure_intake_inquiry(text, uuid)',
    'guard_invoice_party_data_correction()',
    'intake_inquiry_recipients(text, uuid, uuid)',
    'lock_invoice_parent_before_item_change()',
    'notify_new_contact_message()',
    'prevent_party_data_correction_items()',
    'prevent_party_data_correction_payment()',
    'protect_pending_ksef_invoice_inputs()',
    'protect_seller_owner_profit_commission()',
    'protect_seller_owner_profit_payout()',
    'route_inquiry_notification()',
    'sales_insert_copy(regclass, jsonb)',
    'sales_log(uuid, text, text, jsonb, text)',
    'seller_owner_profit_access(uuid, boolean)',
    'seller_owner_profit_context(uuid)'];
  -- Prowizje właściciela: tylko zalogowani (bez service_role).
  v_authenticated_list text[] := ARRAY[
    'book_seller_owner_profit_commission(uuid)',
    'get_commission_settlements(text, text, uuid)',
    'get_seller_owner_profit(uuid)',
    'record_commission_settlement(uuid, text, numeric, date, text, text, uuid, numeric)',
    'save_seller_owner_profit_review(uuid, numeric, text, text, uuid)'];
  v_class text;
  v_sig text;
  v_fn regprocedure;
  v_missing text[] := '{}';
  v_anon regprocedure[] := '{}';
  v_count integer := 0;
  v_list text;
BEGIN
  FOREACH v_class IN ARRAY ARRAY['anon', 'service', 'owner', 'authenticated'] LOOP
    FOREACH v_sig IN ARRAY CASE v_class WHEN 'anon' THEN v_anon_list WHEN 'service' THEN v_service_list
                                        WHEN 'owner' THEN v_owner_list ELSE v_authenticated_list END LOOP
      v_fn := to_regprocedure('public.' || v_sig);
      IF v_fn IS NULL THEN
        v_missing := v_missing || (v_class || ': ' || v_sig);
        CONTINUE;
      END IF;
      IF v_class = 'anon' THEN
        v_anon := v_anon || v_fn;
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated, service_role', v_fn);
      ELSIF v_class = 'service' THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
      ELSIF v_class = 'owner' THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_fn);
      ELSE
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, service_role', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
      END IF;
    END LOOP;
  END LOOP;

  -- Pozostałe funkcje (także utworzone po przeniesieniu): bez EXECUTE dla anon. Funkcje z EXECUTE dla PUBLIC
  -- (pomocnicze SECURITY INVOKER i btree_gist) zostają jak w starym projekcie.
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND pg_has_role(current_user, p.proowner, 'MEMBER')
      AND NOT (p.oid::regprocedure = ANY (v_anon))
      AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                  WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 'anon'::regrole)
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_fn);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Funkcje: odebrano EXECUTE anon pozostałym funkcjom: %; brak w bazie (pominięte): %',
    v_count, coalesce(nullif(array_to_string(v_missing, ', '), ''), 'brak');

  -- Kontrola: funkcje SECURITY DEFINER w public wykonywalne przez anon — wyłącznie z listy strony i linków publicznych.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO v_list
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT (p.oid::regprocedure = ANY (v_anon));
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Funkcje SECURITY DEFINER nadal wykonywalne przez anon: %', v_list; END IF;

  -- Kontrola: funkcje „tylko serwer” bez anon i authenticated, z service_role.
  SELECT string_agg(s, ', ') INTO v_list
  FROM unnest(v_service_list) s
  WHERE to_regprocedure('public.' || s) IS NOT NULL
    AND (has_function_privilege('anon', to_regprocedure('public.' || s), 'EXECUTE')
         OR has_function_privilege('authenticated', to_regprocedure('public.' || s), 'EXECUTE')
         OR NOT has_function_privilege('service_role', to_regprocedure('public.' || s), 'EXECUTE'));
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Funkcje tylko dla serwera mają złe uprawnienia: %', v_list; END IF;

  -- Kontrola: funkcje tylko dla właściciela i prowizji właściciela.
  SELECT string_agg(s, ', ') INTO v_list
  FROM unnest(v_owner_list || v_authenticated_list) s
  WHERE to_regprocedure('public.' || s) IS NOT NULL
    AND (has_function_privilege('anon', to_regprocedure('public.' || s), 'EXECUTE')
         OR has_function_privilege('service_role', to_regprocedure('public.' || s), 'EXECUTE')
         OR has_function_privilege('authenticated', to_regprocedure('public.' || s), 'EXECUTE') <> (s = ANY (v_authenticated_list)));
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Funkcje właściciela mają złe uprawnienia: %', v_list; END IF;
END $$;

-- 3. Tabele, widoki i sekwencje (z kontrolą) ----------------------------------------------------------------------------
-- Format: nazwa|anon|authenticated|service_role — lista uprawnień, „ALL” (wszystkie uprawnienia), „-” (brak).
DO $$
DECLARE
  v_relations text[] := ARRAY[
    -- Zapis tylko przez serwer, odczyt także anon (odmowa wierszy przez RLS).
    'marketing_integrations|ALL|DELETE,INSERT,MAINTAIN,REFERENCES,TRIGGER,TRUNCATE,UPDATE|ALL',
    'sales_brochure_generations|ALL|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'bank_reconciliation_proposals|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'bank_reconciliation_runs|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'finance_declaration_files|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'finance_declaration_lines|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'finance_declaration_payments|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'finance_declarations|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'public_holiday_sync_runs|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'public_holidays|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'sales_partner_branding_profiles|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'scheduled_emails|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'received_emails|MAINTAIN,REFERENCES,SELECT,TRIGGER,UPDATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,UPDATE|ALL',
    'sent_emails|MAINTAIN,REFERENCES,SELECT,TRIGGER,UPDATE|MAINTAIN,REFERENCES,SELECT,TRIGGER,UPDATE|ALL',
    'time_entries_history|MAINTAIN,REFERENCES,SELECT,TRIGGER|MAINTAIN,REFERENCES,SELECT,TRIGGER|ALL',
    'email_attachments|MAINTAIN,REFERENCES,TRIGGER|MAINTAIN,REFERENCES,SELECT,TRIGGER|ALL',
    'service_slug_aliases|SELECT|SELECT|ALL',
    -- Bez dostępu z API.
    'seller_owner_profit_reviews|-|-|-',
    -- Tylko serwer.
    '_backup_equipment_items|-|-|ALL',
    '_backup_equipment_units|-|-|ALL',
    'bank_transactions_import_archive|-|-|ALL',
    'contract_signed_files|-|-|ALL',
    'crm_business_notification_outbox|-|-|ALL',
    'email_trash_operations|-|-|ALL',
    'event_external_seller_rates|-|-|ALL',
    'event_invoice_company_sources|-|-|ALL',
    'event_workflow_attention|-|-|ALL',
    'mac_sync_bindings|-|-|ALL',
    'mac_sync_file_versions|-|-|ALL',
    'mac_sync_files|-|-|ALL',
    'meeting_reminder_deliveries|-|-|ALL',
    'meeting_series|-|-|ALL',
    'personnel_number_counters|-|-|ALL',
    'sales_partner_component_prices|-|-|ALL',
    'seller_configuration_quotes|-|-|ALL',
    'seller_inquiries|-|-|ALL',
    'seller_inquiry_links|-|-|ALL',
    'seller_offer_arrangement_audit|-|-|ALL',
    'seller_offer_arrangements|-|-|ALL',
    'seller_offer_client_acceptances|-|-|ALL',
    'seller_offer_delivery_settings|-|-|ALL',
    'seller_offer_email_deliveries|-|-|ALL',
    'seller_offer_review_audit|-|-|ALL',
    'seller_offer_reviews|-|-|ALL',
    'seller_offer_save_requests|-|-|ALL',
    'seller_offer_share_links|-|-|ALL',
    'seller_realization_step_history|-|-|ALL',
    'seller_realization_steps|-|-|ALL',
    'seller_realization_submissions|-|-|ALL',
    'seller_realization_workflows|-|-|ALL',
    'time_entry_thread_messages|-|-|ALL',
    'time_entry_threads|-|-|ALL',
    -- Zalogowani — bez anon.
    'event_contact_persons|-|ALL|ALL',
    'mavinci_view_commands|-|ALL|ALL',
    'mavinci_view_media|-|ALL|ALL',
    'offer_product_preparation_items|-|ALL|ALL',
    'meeting_events|-|DELETE,INSERT,MAINTAIN,SELECT,UPDATE|ALL',
    'bank_counterparty_mapping_templates|-|DELETE,INSERT,SELECT,UPDATE|ALL',
    'bank_transaction_supporting_documents|-|DELETE,INSERT,SELECT,UPDATE|ALL',
    'personnel_work_entries|-|DELETE,INSERT,SELECT|ALL',
    'notification_recipients|-|DELETE,MAINTAIN,REFERENCES,SELECT,TRIGGER|ALL',
    'ksef_credentials|-|INSERT,MAINTAIN,UPDATE|ALL',
    'personnel_contract_templates|-|INSERT,SELECT,UPDATE|ALL',
    'accounting_month_handoffs|-|INSERT,SELECT|ALL',
    'saldeo_delivery_log|-|INSERT,SELECT|ALL',
    'mavinci_view_devices|-|MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE|ALL',
    'notifications|-|MAINTAIN,REFERENCES,SELECT,TRIGGER|ALL',
    'bank_transaction_refund_pairs|-|MAINTAIN,SELECT|ALL',
    'finance_recurring_contract_files|-|MAINTAIN,SELECT|ALL',
    'finance_recurring_contract_payments|-|MAINTAIN,SELECT|ALL',
    'finance_recurring_contracts|-|MAINTAIN,SELECT|ALL',
    'compensation_settings|-|SELECT,UPDATE|ALL',
    'financial_payment_review_issues|-|SELECT,UPDATE|ALL',
    -- Zalogowani: tylko odczyt (zapis przez funkcje).
    'accounting_delivery_attempts|-|SELECT|ALL',
    'accounting_document_followups|-|SELECT|ALL',
    'bank_transaction_invoice_matches|-|SELECT|ALL',
    'contract_cancellation_audit|-|SELECT|ALL',
    'employee_compensation|-|SELECT|ALL',
    'employee_sales_commission_terms|-|SELECT|ALL',
    'employee_sales_commission_terms_audit|-|SELECT|ALL',
    'employee_time_settlements|-|SELECT|ALL',
    'event_commission_history|-|SELECT|ALL',
    'event_equipment_check_log|-|SELECT|ALL',
    'event_equipment_checklists|-|SELECT|ALL',
    'event_equipment_checks|-|SELECT|ALL',
    'event_financials|-|SELECT|ALL',
    'event_realizations|-|SELECT|ALL',
    'event_sales_share_audit|-|SELECT|ALL',
    'event_sales_shares|-|SELECT|ALL',
    'event_settlement_lines|-|SELECT|ALL',
    'event_settlement_versions|-|SELECT|ALL',
    'event_settlements|-|SELECT|ALL',
    'event_step_activity|-|SELECT|ALL',
    'event_steps|-|SELECT|ALL',
    'event_warehouse_handoffs|-|SELECT|ALL',
    'inquiry_team_members|-|SELECT|ALL',
    'legacy_bank_transaction_match_audit|-|SELECT|ALL',
    'mailbox_control_access_log|-|SELECT|ALL',
    'offer_amendments|-|SELECT|ALL',
    'offer_draft_revisions|-|SELECT|ALL',
    'offer_english_content|-|SELECT|ALL',
    'offer_language_documents|-|SELECT|ALL',
    'organization_offer_branding|-|SELECT|ALL',
    'personnel_contract_documents|-|SELECT|ALL',
    'personnel_contract_rates|-|SELECT|ALL',
    'personnel_people|-|SELECT|ALL',
    'personnel_settlements|-|SELECT|ALL',
    'personnel_statutory_rates|-|SELECT|ALL',
    'sales_brochure_deliveries|-|SELECT|ALL',
    'sales_partner_audit|-|SELECT|ALL',
    'sales_partner_clients|-|SELECT|ALL',
    'seller_conversations|-|SELECT|ALL',
    'seller_demo_generations|-|SELECT|ALL',
    'seller_demo_sessions|-|SELECT|ALL',
    'seller_demo_visits|-|SELECT|ALL',
    'seller_message_reads|-|SELECT|ALL',
    'seller_messages|-|SELECT|ALL',
    'seller_offer_documents|-|SELECT|ALL',
    'seller_review_reads|-|SELECT|ALL',
    'event_commission_payouts|-|SELECT|SELECT',
    -- Sekwencja numerów zamówień partnera — tylko serwer.
    'partner_order_number_seq|-|-|SELECT,UPDATE,USAGE',
    -- Widoki.
    'website_team_members|-|-|ALL',
    'equipment_external_rentals|-|MAINTAIN,SELECT|ALL',
    'event_phase_resource_summary|-|MAINTAIN,SELECT|ALL',
    'fleet_vehicles_view|-|MAINTAIN,SELECT|ALL',
    'invoices_with_relations|-|MAINTAIN,SELECT|ALL',
    'offer_products_with_subcontractor|-|MAINTAIN,SELECT|ALL'];
  v_all_table text[] := ARRAY['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'];
  v_all_sequence text[] := ARRAY['SELECT', 'UPDATE', 'USAGE'];
  v_roles text[] := ARRAY['anon', 'authenticated', 'service_role'];
  v_pass integer;
  v_row text;
  v_parts text[];
  v_rel regclass;
  v_kind "char";
  v_object text;
  v_index integer;
  v_target text[];
  v_current text[];
  v_change text[];
  v_column_grants text[];
  v_statement text;
  v_missing text[] := '{}';
  v_changed integer := 0;
BEGIN
  -- Uprawnienia kolumn ról API — odebranie uprawnienia tabeli odbiera też to samo uprawnienie kolumn.
  SELECT coalesce(array_agg(format('GRANT %s (%I) ON TABLE %s TO %s', a.privilege_type, att.attname, c.oid::regclass,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(a.grantee::regrole::text) END)), '{}')
    INTO v_column_grants
  FROM pg_attribute att
  JOIN pg_class c ON c.oid = att.attrelid
  CROSS JOIN LATERAL aclexplode(att.attacl) a
  WHERE c.relnamespace = 'public'::regnamespace AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL
    AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));

  -- Przebieg 1: zmiana uprawnień; przebieg 2: kontrola (po ponownym nadaniu uprawnień kolumn).
  FOR v_pass IN 1..2 LOOP
    IF v_pass = 2 THEN
      FOREACH v_statement IN ARRAY v_column_grants LOOP
        EXECUTE v_statement;
      END LOOP;
    END IF;

    FOREACH v_row IN ARRAY v_relations LOOP
      v_parts := string_to_array(v_row, '|');
      v_rel := to_regclass('public.' || quote_ident(v_parts[1]));
      IF v_rel IS NULL THEN
        IF v_pass = 1 THEN v_missing := v_missing || v_parts[1]; END IF;
        CONTINUE;
      END IF;
      SELECT c.relkind INTO v_kind FROM pg_class c WHERE c.oid = v_rel;
      v_object := CASE WHEN v_kind = 'S' THEN 'SEQUENCE ' ELSE 'TABLE ' END || v_rel::text;

      FOR v_index IN 0..3 LOOP
        -- 0 = PUBLIC (brak uprawnień we wzorcu), 1..3 = anon, authenticated, service_role.
        v_target := CASE
          WHEN v_index = 0 OR v_parts[v_index + 1] = '-' THEN '{}'::text[]
          WHEN v_parts[v_index + 1] = 'ALL' AND v_kind = 'S' THEN v_all_sequence
          WHEN v_parts[v_index + 1] = 'ALL' THEN v_all_table
          ELSE string_to_array(v_parts[v_index + 1], ',') END;
        SELECT coalesce(array_agg(a.privilege_type ORDER BY a.privilege_type), '{}') INTO v_current
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,
          acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a
        WHERE c.oid = v_rel AND a.grantee = CASE WHEN v_index = 0 THEN 0::oid ELSE v_roles[v_index]::regrole::oid END;

        IF v_pass = 2 THEN
          IF NOT (v_current @> v_target AND v_current <@ v_target) THEN
            RAISE EXCEPTION 'Uprawnienia % dla % różnią się od wzorca: jest %, ma być %.', v_parts[1],
              CASE WHEN v_index = 0 THEN 'PUBLIC' ELSE v_roles[v_index] END, v_current, v_target;
          END IF;
          CONTINUE;
        END IF;

        v_change := ARRAY(SELECT unnest(v_current) EXCEPT SELECT unnest(v_target) ORDER BY 1);
        IF cardinality(v_change) > 0 THEN
          EXECUTE format('REVOKE %s ON %s FROM %s', array_to_string(v_change, ', '), v_object,
            CASE WHEN v_index = 0 THEN 'PUBLIC' ELSE quote_ident(v_roles[v_index]) END);
          v_changed := v_changed + 1;
        END IF;
        v_change := ARRAY(SELECT unnest(v_target) EXCEPT SELECT unnest(v_current) ORDER BY 1);
        IF cardinality(v_change) > 0 THEN
          EXECUTE format('GRANT %s ON %s TO %I', array_to_string(v_change, ', '), v_object, v_roles[v_index]);
          v_changed := v_changed + 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Tabele: zmienione uprawnienia ról: %; uprawnienia kolumn nadane ponownie: %; brak w bazie (pominięte): %',
    v_changed, cardinality(v_column_grants), coalesce(nullif(array_to_string(v_missing, ', '), ''), 'brak');
END $$;

-- 4. Kontrola końcowa -------------------------------------------------------------------------------------------------
DO $$
DECLARE v_list text;
BEGIN
  -- a) Polityki zezwalające dla public/anon nie wołają funkcji SECURITY DEFINER, której anon nie może wykonać
  --    (zapytanie anon kończyłoby się błędem „permission denied for function”). Restrykcyjne strażniki widoczności
  --    tabeli events dla roli public wołają funkcje tylko dla zalogowanych tak jak w starym projekcie — anon nie ma
  --    polityk zezwalających na events.
  SELECT string_agg(DISTINCT pol.schemaname || '.' || pol.tablename || ' „' || pol.policyname || '” → ' || p.proname, ', ') INTO v_list
  FROM pg_policies pol
  JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace AND p.prosecdef
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ ('(^|[^a-z0-9_.])(public\.)?' || p.proname || '\(')
  WHERE pol.schemaname IN ('public', 'storage') AND pol.permissive = 'PERMISSIVE'
    AND pol.roles && ARRAY['public', 'anon']::name[];
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'Polityki dla anon wołają funkcje bez EXECUTE dla anon: %', v_list; END IF;

  -- b) Sekrety KSeF nieczytelne z API; kolumny statusu nadal czytelne dla zalogowanych.
  IF has_column_privilege('authenticated', 'public.ksef_credentials', 'token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ksef_credentials', 'certificate_key', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ksef_credentials', 'certificate_password', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ksef_credentials', 'access_token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ksef_credentials', 'refresh_token', 'SELECT')
     OR has_table_privilege('anon', 'public.ksef_credentials', 'SELECT') THEN
    RAISE EXCEPTION 'ksef_credentials: sekrety nadal czytelne z API.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.ksef_credentials', 'auto_sync_last_error', 'SELECT') THEN
    RAISE EXCEPTION 'ksef_credentials: zalogowany nie czyta kolumn bez sekretów (status synchronizacji).';
  END IF;

  -- c) Powiadomienia: zalogowany nie wstawia; odbiorca oznacza jako przeczytane.
  IF has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.notifications', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.notification_recipients', 'is_read', 'UPDATE') THEN
    RAISE EXCEPTION 'Powiadomienia: uprawnienia różnią się od wzorca.';
  END IF;

  -- d) Domyślne uprawnienia: nowe funkcje bez EXECUTE dla PUBLIC i anon.
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
             WHERE d.defaclobjtype = 'f' AND pg_has_role(current_user, d.defaclrole, 'MEMBER')
               AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
               AND a.privilege_type = 'EXECUTE'
               AND (a.grantee = 0 OR a.grantee = 'anon'::regrole)) THEN
    RAISE EXCEPTION 'Domyślne uprawnienia nadal nadają EXECUTE nowym funkcjom dla PUBLIC/anon.';
  END IF;
END $$;

COMMIT;
