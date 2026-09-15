export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      aade_import_batches: {
        Row: {
          committed_at: string | null
          dup_count: number | null
          file_sha256: string
          filename: string
          id: string
          kind: Database["public"]["Enums"]["aade_kind"] | null
          new_count: number | null
          org_id: string
          period: string | null
          row_count: number
          status: Database["public"]["Enums"]["aade_batch_status"]
          storage_path: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          committed_at?: string | null
          dup_count?: number | null
          file_sha256: string
          filename: string
          id?: string
          kind?: Database["public"]["Enums"]["aade_kind"] | null
          new_count?: number | null
          org_id: string
          period?: string | null
          row_count?: number
          status?: Database["public"]["Enums"]["aade_batch_status"]
          storage_path?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          committed_at?: string | null
          dup_count?: number | null
          file_sha256?: string
          filename?: string
          id?: string
          kind?: Database["public"]["Enums"]["aade_kind"] | null
          new_count?: number | null
          org_id?: string
          period?: string | null
          row_count?: number
          status?: Database["public"]["Enums"]["aade_batch_status"]
          storage_path?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aade_import_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aade_import_batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      aade_staging_rows: {
        Row: {
          account_id: string | null
          batch_id: string
          category_id: string | null
          committed_transaction_id: string | null
          counterparty_afm: string | null
          counterparty_name: string | null
          decision: Database["public"]["Enums"]["aade_decision"]
          deductions: number | null
          dedup_status: Database["public"]["Enums"]["aade_dedup_status"]
          digital_fee: number | null
          direction: Database["public"]["Enums"]["tx_direction"] | null
          discrepancy: string | null
          document_type: string | null
          fees: number | null
          fingerprint: string | null
          gross_amount: number | null
          id: string
          invoice_number: string | null
          issue_date: string | null
          issuer_afm: string | null
          kad_code: string | null
          kad_description: string | null
          matched_transaction_id: string | null
          mydata_mark: string | null
          net_amount: number | null
          org_id: string
          other_taxes: number | null
          parse_errors: string[] | null
          project_id: string | null
          raw: Json
          receiver_afm: string | null
          row_no: number
          scope: Database["public"]["Enums"]["tx_scope"]
          status: Database["public"]["Enums"]["tx_status"]
          vat_amount: number | null
          withholding_amount: number | null
        }
        Insert: {
          account_id?: string | null
          batch_id: string
          category_id?: string | null
          committed_transaction_id?: string | null
          counterparty_afm?: string | null
          counterparty_name?: string | null
          decision?: Database["public"]["Enums"]["aade_decision"]
          deductions?: number | null
          dedup_status?: Database["public"]["Enums"]["aade_dedup_status"]
          digital_fee?: number | null
          direction?: Database["public"]["Enums"]["tx_direction"] | null
          discrepancy?: string | null
          document_type?: string | null
          fees?: number | null
          fingerprint?: string | null
          gross_amount?: number | null
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          issuer_afm?: string | null
          kad_code?: string | null
          kad_description?: string | null
          matched_transaction_id?: string | null
          mydata_mark?: string | null
          net_amount?: number | null
          org_id: string
          other_taxes?: number | null
          parse_errors?: string[] | null
          project_id?: string | null
          raw: Json
          receiver_afm?: string | null
          row_no: number
          scope?: Database["public"]["Enums"]["tx_scope"]
          status?: Database["public"]["Enums"]["tx_status"]
          vat_amount?: number | null
          withholding_amount?: number | null
        }
        Update: {
          account_id?: string | null
          batch_id?: string
          category_id?: string | null
          committed_transaction_id?: string | null
          counterparty_afm?: string | null
          counterparty_name?: string | null
          decision?: Database["public"]["Enums"]["aade_decision"]
          deductions?: number | null
          dedup_status?: Database["public"]["Enums"]["aade_dedup_status"]
          digital_fee?: number | null
          direction?: Database["public"]["Enums"]["tx_direction"] | null
          discrepancy?: string | null
          document_type?: string | null
          fees?: number | null
          fingerprint?: string | null
          gross_amount?: number | null
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          issuer_afm?: string | null
          kad_code?: string | null
          kad_description?: string | null
          matched_transaction_id?: string | null
          mydata_mark?: string | null
          net_amount?: number | null
          org_id?: string
          other_taxes?: number | null
          parse_errors?: string[] | null
          project_id?: string | null
          raw?: Json
          receiver_afm?: string | null
          row_no?: number
          scope?: Database["public"]["Enums"]["tx_scope"]
          status?: Database["public"]["Enums"]["tx_status"]
          vat_amount?: number | null
          withholding_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "aade_staging_rows_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aade_staging_rows_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "aade_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aade_staging_rows_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_afm_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_amount_identity_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_capex_to_lessor"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_future_dated"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_missing_project_or_account"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_non_positive_amounts"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_spend_without_treatment"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_vat_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_committed_transaction_id_fkey"
            columns: ["committed_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_withholding_on_income"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_afm_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_amount_identity_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_capex_to_lessor"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_future_dated"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_missing_project_or_account"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_non_positive_amounts"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_spend_without_treatment"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_vat_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_withholding_on_income"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aade_staging_rows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aade_staging_rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "aade_staging_rows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          iban: string | null
          id: string
          is_active: boolean
          is_liquid: boolean
          kind: Database["public"]["Enums"]["account_kind"]
          name: string
          notes: string | null
          opening_balance: number
          opening_balance_date: string
          org_id: string
          owner_scope: Database["public"]["Enums"]["owner_scope"]
          project_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          iban?: string | null
          id?: string
          is_active?: boolean
          is_liquid?: boolean
          kind?: Database["public"]["Enums"]["account_kind"]
          name: string
          notes?: string | null
          opening_balance?: number
          opening_balance_date: string
          org_id: string
          owner_scope: Database["public"]["Enums"]["owner_scope"]
          project_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          iban?: string | null
          id?: string
          is_active?: boolean
          is_liquid?: boolean
          kind?: Database["public"]["Enums"]["account_kind"]
          name?: string
          notes?: string | null
          opening_balance?: number
          opening_balance_date?: string
          org_id?: string
          owner_scope?: Database["public"]["Enums"]["owner_scope"]
          project_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "accounts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "accounts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      agent_changes: {
        Row: {
          after: Json
          before: Json | null
          created_at: string
          id: string
          operation: Database["public"]["Enums"]["agent_change_op"]
          org_id: string
          reason: string | null
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          row_id: string | null
          status: Database["public"]["Enums"]["agent_change_status"]
          table_name: string
        }
        Insert: {
          after: Json
          before?: Json | null
          created_at?: string
          id?: string
          operation: Database["public"]["Enums"]["agent_change_op"]
          org_id: string
          reason?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_id?: string | null
          status?: Database["public"]["Enums"]["agent_change_status"]
          table_name: string
        }
        Update: {
          after?: Json
          before?: Json | null
          created_at?: string
          id?: string
          operation?: Database["public"]["Enums"]["agent_change_op"]
          org_id?: string
          reason?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_id?: string | null
          status?: Database["public"]["Enums"]["agent_change_status"]
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_changes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_changes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      ai_corrections: {
        Row: {
          ai_value: Json | null
          created_at: string
          document_id: string | null
          field: string
          human_value: Json | null
          id: string
          model: string | null
          org_id: string
        }
        Insert: {
          ai_value?: Json | null
          created_at?: string
          document_id?: string | null
          field: string
          human_value?: Json | null
          id?: string
          model?: string | null
          org_id: string
        }
        Update: {
          ai_value?: Json | null
          created_at?: string
          document_id?: string | null
          field?: string
          human_value?: Json | null
          id?: string
          model?: string | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_corrections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_corrections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_corrections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          cache_read_tokens: number | null
          cost_cents: number | null
          created_at: string
          feature: string
          id: string
          input_tokens: number | null
          model: string
          org_id: string
          output_tokens: number | null
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          cache_read_tokens?: number | null
          cost_cents?: number | null
          created_at?: string
          feature: string
          id?: string
          input_tokens?: number | null
          model: string
          org_id: string
          output_tokens?: number | null
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          cache_read_tokens?: number | null
          cost_cents?: number | null
          created_at?: string
          feature?: string
          id?: string
          input_tokens?: number | null
          model?: string
          org_id?: string
          output_tokens?: number | null
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      assets: {
        Row: {
          category: string | null
          created_at: string
          estimated_value: number
          id: string
          name: string
          notes: string | null
          org_id: string
          owner_scope: Database["public"]["Enums"]["owner_scope"]
          ownership_pct: number
          state: Database["public"]["Enums"]["asset_state"]
          updated_at: string
          valuation_date: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          estimated_value: number
          id?: string
          name: string
          notes?: string | null
          org_id: string
          owner_scope?: Database["public"]["Enums"]["owner_scope"]
          ownership_pct?: number
          state?: Database["public"]["Enums"]["asset_state"]
          updated_at?: string
          valuation_date?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          estimated_value?: number
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          owner_scope?: Database["public"]["Enums"]["owner_scope"]
          ownership_pct?: number
          state?: Database["public"]["Enums"]["asset_state"]
          updated_at?: string
          valuation_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      attachments: {
        Row: {
          filename: string | null
          id: string
          mime_type: string | null
          org_id: string
          size_bytes: number | null
          storage_path: string
          transaction_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          filename?: string | null
          id?: string
          mime_type?: string | null
          org_id: string
          size_bytes?: number | null
          storage_path: string
          transaction_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          filename?: string | null
          id?: string
          mime_type?: string | null
          org_id?: string
          size_bytes?: number | null
          storage_path?: string
          transaction_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_afm_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_amount_identity_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_capex_to_lessor"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_future_dated"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_missing_project_or_account"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_non_positive_amounts"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_spend_without_treatment"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_vat_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_withholding_on_income"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      budget_lines: {
        Row: {
          amount: number
          budget_id: string
          id: string
          label: string | null
          line_code: Database["public"]["Enums"]["budget_line_code"]
          org_id: string
        }
        Insert: {
          amount?: number
          budget_id: string
          id?: string
          label?: string | null
          line_code: Database["public"]["Enums"]["budget_line_code"]
          org_id: string
        }
        Update: {
          amount?: number
          budget_id?: string
          id?: string
          label?: string | null
          line_code?: Database["public"]["Enums"]["budget_line_code"]
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "project_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      categories: {
        Row: {
          code: string | null
          cost_treatment: Database["public"]["Enums"]["cost_treatment"] | null
          created_at: string
          id: string
          is_active: boolean
          is_financing: boolean
          keywords: string[]
          kind: Database["public"]["Enums"]["tx_direction"] | null
          name: string
          org_id: string
          parent_id: string | null
          scope: Database["public"]["Enums"]["tx_scope"]
          sort_order: number
          updated_at: string
        }
        Insert: {
          code?: string | null
          cost_treatment?: Database["public"]["Enums"]["cost_treatment"] | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_financing?: boolean
          keywords?: string[]
          kind?: Database["public"]["Enums"]["tx_direction"] | null
          name: string
          org_id: string
          parent_id?: string | null
          scope?: Database["public"]["Enums"]["tx_scope"]
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string | null
          cost_treatment?: Database["public"]["Enums"]["cost_treatment"] | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_financing?: boolean
          keywords?: string[]
          kind?: Database["public"]["Enums"]["tx_direction"] | null
          name?: string
          org_id?: string
          parent_id?: string | null
          scope?: Database["public"]["Enums"]["tx_scope"]
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          address: string | null
          afm: string | null
          aliases: string[]
          created_at: string
          default_vat_rate: number
          default_withholding_rate: number
          email: string | null
          iban: string | null
          id: string
          is_active: boolean
          kad_code: string | null
          kad_description: string | null
          kind: string | null
          name: string
          notes: string | null
          org_id: string
          payment_terms_days: number | null
          phone: string | null
          search_key: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          afm?: string | null
          aliases?: string[]
          created_at?: string
          default_vat_rate?: number
          default_withholding_rate?: number
          email?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          kad_code?: string | null
          kad_description?: string | null
          kind?: string | null
          name: string
          notes?: string | null
          org_id: string
          payment_terms_days?: number | null
          phone?: string | null
          search_key?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          afm?: string | null
          aliases?: string[]
          created_at?: string
          default_vat_rate?: number
          default_withholding_rate?: number
          email?: string | null
          iban?: string | null
          id?: string
          is_active?: boolean
          kad_code?: string | null
          kad_description?: string | null
          kind?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          payment_terms_days?: number | null
          phone?: string | null
          search_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      document_jobs: {
        Row: {
          attempts: number
          cost_cents: number | null
          created_at: string
          document_id: string
          id: string
          input_tokens: number | null
          last_error: string | null
          model: string | null
          org_id: string
          output_tokens: number | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          cost_cents?: number | null
          created_at?: string
          document_id: string
          id?: string
          input_tokens?: number | null
          last_error?: string | null
          model?: string | null
          org_id: string
          output_tokens?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          cost_cents?: number | null
          created_at?: string
          document_id?: string
          id?: string
          input_tokens?: number | null
          last_error?: string | null
          model?: string | null
          org_id?: string
          output_tokens?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      documents: {
        Row: {
          byte_size: number | null
          created_at: string
          id: string
          mime_type: string | null
          org_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          id?: string
          mime_type?: string | null
          org_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          id?: string
          mime_type?: string | null
          org_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      expected_income: {
        Row: {
          amount: number
          certainty: Database["public"]["Enums"]["certainty"]
          contact_id: string | null
          created_at: string
          creates_liability: boolean
          expected_month: string | null
          id: string
          notes: string | null
          org_id: string
          project_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          amount: number
          certainty?: Database["public"]["Enums"]["certainty"]
          contact_id?: string | null
          created_at?: string
          creates_liability?: boolean
          expected_month?: string | null
          id?: string
          notes?: string | null
          org_id: string
          project_id?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          amount?: number
          certainty?: Database["public"]["Enums"]["certainty"]
          contact_id?: string | null
          created_at?: string
          creates_liability?: boolean
          expected_month?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          project_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expected_income_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expected_income_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "expected_income_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_qc_contacts_missing_afm"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "expected_income_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expected_income_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "expected_income_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expected_income_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "expected_income_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      installment_plans: {
        Row: {
          account_id: string | null
          amount_per_installment: number
          category_id: string | null
          contact_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["tx_direction"]
          end_date: string | null
          escalation_pct: number
          first_due_date: string
          frequency: Database["public"]["Enums"]["plan_frequency"]
          generated_through: string | null
          horizon_months: number
          id: string
          installment_count: number | null
          label: string
          notes: string | null
          obligation_kind: Database["public"]["Enums"]["obligation_kind"]
          org_id: string
          project_id: string | null
          scope: Database["public"]["Enums"]["tx_scope"]
          status: Database["public"]["Enums"]["plan_status"]
          updated_at: string
          vat_per_installment: number
          vat_rate: number | null
          withholding_per_installment: number
        }
        Insert: {
          account_id?: string | null
          amount_per_installment: number
          category_id?: string | null
          contact_id?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["tx_direction"]
          end_date?: string | null
          escalation_pct?: number
          first_due_date: string
          frequency?: Database["public"]["Enums"]["plan_frequency"]
          generated_through?: string | null
          horizon_months?: number
          id?: string
          installment_count?: number | null
          label: string
          notes?: string | null
          obligation_kind?: Database["public"]["Enums"]["obligation_kind"]
          org_id: string
          project_id?: string | null
          scope?: Database["public"]["Enums"]["tx_scope"]
          status?: Database["public"]["Enums"]["plan_status"]
          updated_at?: string
          vat_per_installment?: number
          vat_rate?: number | null
          withholding_per_installment?: number
        }
        Update: {
          account_id?: string | null
          amount_per_installment?: number
          category_id?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["tx_direction"]
          end_date?: string | null
          escalation_pct?: number
          first_due_date?: string
          frequency?: Database["public"]["Enums"]["plan_frequency"]
          generated_through?: string | null
          horizon_months?: number
          id?: string
          installment_count?: number | null
          label?: string
          notes?: string | null
          obligation_kind?: Database["public"]["Enums"]["obligation_kind"]
          org_id?: string
          project_id?: string | null
          scope?: Database["public"]["Enums"]["tx_scope"]
          status?: Database["public"]["Enums"]["plan_status"]
          updated_at?: string
          vat_per_installment?: number
          vat_rate?: number | null
          withholding_per_installment?: number
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "installment_plans_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "installment_plans_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_qc_contacts_missing_afm"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "installment_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "installment_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "installment_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      liabilities: {
        Row: {
          contact_id: string | null
          created_at: string
          id: string
          interest_rate: number
          kind: Database["public"]["Enums"]["liability_kind"]
          lender: string
          maturity_date: string | null
          org_id: string
          owner_scope: Database["public"]["Enums"]["owner_scope"]
          principal: number
          state: Database["public"]["Enums"]["liability_state"]
          terms: string | null
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          id?: string
          interest_rate?: number
          kind?: Database["public"]["Enums"]["liability_kind"]
          lender: string
          maturity_date?: string | null
          org_id: string
          owner_scope?: Database["public"]["Enums"]["owner_scope"]
          principal: number
          state?: Database["public"]["Enums"]["liability_state"]
          terms?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          id?: string
          interest_rate?: number
          kind?: Database["public"]["Enums"]["liability_kind"]
          lender?: string
          maturity_date?: string | null
          org_id?: string
          owner_scope?: Database["public"]["Enums"]["owner_scope"]
          principal?: number
          state?: Database["public"]["Enums"]["liability_state"]
          terms?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "liabilities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liabilities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "liabilities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_qc_contacts_missing_afm"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "liabilities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liabilities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      loan_drawdowns: {
        Row: {
          actual_amount: number | null
          actual_date: string | null
          amount: number
          id: string
          loan_id: string
          org_id: string
          scheduled_month: string
        }
        Insert: {
          actual_amount?: number | null
          actual_date?: string | null
          amount: number
          id?: string
          loan_id: string
          org_id: string
          scheduled_month: string
        }
        Update: {
          actual_amount?: number | null
          actual_date?: string | null
          amount?: number
          id?: string
          loan_id?: string
          org_id?: string
          scheduled_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_drawdowns_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_drawdowns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_drawdowns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      loans: {
        Row: {
          created_at: string
          first_amortisation_month: string | null
          grace_years: number
          id: string
          interest_rate: number
          label: string
          notes: string | null
          org_id: string
          principal: number
          project_id: string | null
          state: Database["public"]["Enums"]["liability_state"]
          term_years: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_amortisation_month?: string | null
          grace_years?: number
          id?: string
          interest_rate: number
          label: string
          notes?: string | null
          org_id: string
          principal: number
          project_id?: string | null
          state?: Database["public"]["Enums"]["liability_state"]
          term_years: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_amortisation_month?: string | null
          grace_years?: number
          id?: string
          interest_rate?: number
          label?: string
          notes?: string | null
          org_id?: string
          principal?: number
          project_id?: string | null
          state?: Database["public"]["Enums"]["liability_state"]
          term_years?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "loans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "loans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string
          id: string
          legal_name: string | null
          name: string
          own_afm: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          legal_name?: string | null
          name: string
          own_afm: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          legal_name?: string | null
          name?: string
          own_afm?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          display_name: string | null
          email: string | null
          user_id: string
        }
        Insert: {
          display_name?: string | null
          email?: string | null
          user_id: string
        }
        Update: {
          display_name?: string | null
          email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      project_budgets: {
        Row: {
          contingency_pct: number
          created_at: string
          id: string
          is_current: boolean
          non_deductible_vat: number
          notes: string | null
          org_id: string
          project_id: string
          updated_at: string
          version: number
        }
        Insert: {
          contingency_pct?: number
          created_at?: string
          id?: string
          is_current?: boolean
          non_deductible_vat?: number
          notes?: string | null
          org_id: string
          project_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          contingency_pct?: number
          created_at?: string
          id?: string
          is_current?: boolean
          non_deductible_vat?: number
          notes?: string | null
          org_id?: string
          project_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_budgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_budgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "project_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_model_inputs: {
        Row: {
          key: string
          org_id: string
          project_id: string
          value: Json
        }
        Insert: {
          key: string
          org_id: string
          project_id: string
          value: Json
        }
        Update: {
          key?: string
          org_id?: string
          project_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_model_inputs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_model_inputs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "project_model_inputs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_model_inputs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_model_inputs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_seasonality: {
        Row: {
          month: number
          org_id: string
          project_id: string
          revenue_pct: number
        }
        Insert: {
          month: number
          org_id: string
          project_id: string
          revenue_pct: number
        }
        Update: {
          month?: number
          org_id?: string
          project_id?: string
          revenue_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_seasonality_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_seasonality_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "project_seasonality_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_seasonality_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_seasonality_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      projects: {
        Row: {
          aliases: string[]
          business_model: Database["public"]["Enums"]["business_model"] | null
          code: string
          collateral_value: number | null
          construction_end_date: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          legal_relation: string | null
          opening_date: string | null
          org_id: string
          phase: string | null
          project_type: Database["public"]["Enums"]["project_type"] | null
          rent_start_date: string | null
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          units: number | null
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          business_model?: Database["public"]["Enums"]["business_model"] | null
          code: string
          collateral_value?: number | null
          construction_end_date?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          legal_relation?: string | null
          opening_date?: string | null
          org_id: string
          phase?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          rent_start_date?: string | null
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          units?: number | null
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          business_model?: Database["public"]["Enums"]["business_model"] | null
          code?: string
          collateral_value?: number | null
          construction_end_date?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          legal_relation?: string | null
          opening_date?: string | null
          org_id?: string
          phase?: string | null
          project_type?: Database["public"]["Enums"]["project_type"] | null
          rent_start_date?: string | null
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          units?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      revenue_plan_assumptions: {
        Row: {
          adr: number
          id: string
          month_number: number
          occupancy_pct: number
          org_id: string
          room_type_id: string
          year_number: number
        }
        Insert: {
          adr: number
          id?: string
          month_number: number
          occupancy_pct: number
          org_id: string
          room_type_id: string
          year_number: number
        }
        Update: {
          adr?: number
          id?: string
          month_number?: number
          occupancy_pct?: number
          org_id?: string
          room_type_id?: string
          year_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "revenue_plan_assumptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_plan_assumptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "revenue_plan_assumptions_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "revenue_plan_room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_plan_room_types: {
        Row: {
          id: string
          name: string
          org_id: string
          revenue_plan_id: string
          sort_order: number
          unit_count: number
        }
        Insert: {
          id?: string
          name: string
          org_id: string
          revenue_plan_id: string
          sort_order?: number
          unit_count: number
        }
        Update: {
          id?: string
          name?: string
          org_id?: string
          revenue_plan_id?: string
          sort_order?: number
          unit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "revenue_plan_room_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_plan_room_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "revenue_plan_room_types_revenue_plan_id_fkey"
            columns: ["revenue_plan_id"]
            isOneToOne: false
            referencedRelation: "revenue_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_plans: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          project_id: string | null
          start_year: number
          updated_at: string
          years: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          project_id?: string | null
          start_year: number
          updated_at?: string
          years?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          project_id?: string | null
          start_year?: number
          updated_at?: string
          years?: number
        }
        Relationships: [
          {
            foreignKeyName: "revenue_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "revenue_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "revenue_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      transaction_drafts: {
        Row: {
          approved_transaction_id: string | null
          created_at: string
          document_id: string | null
          extracted: Json
          id: string
          needs_review_reasons: string[]
          org_id: string
          proposed: Json
          source: Database["public"]["Enums"]["tx_origin"]
          status: string
        }
        Insert: {
          approved_transaction_id?: string | null
          created_at?: string
          document_id?: string | null
          extracted: Json
          id?: string
          needs_review_reasons?: string[]
          org_id: string
          proposed: Json
          source: Database["public"]["Enums"]["tx_origin"]
          status?: string
        }
        Update: {
          approved_transaction_id?: string | null
          created_at?: string
          document_id?: string | null
          extracted?: Json
          id?: string
          needs_review_reasons?: string[]
          org_id?: string
          proposed?: Json
          source?: Database["public"]["Enums"]["tx_origin"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_afm_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_amount_identity_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_capex_to_lessor"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_future_dated"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_missing_project_or_account"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_non_positive_amounts"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_spend_without_treatment"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_vat_mismatch"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_approved_transaction_id_fkey"
            columns: ["approved_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_qc_withholding_on_income"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transaction_drafts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_drafts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_drafts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      transactions: {
        Row: {
          aade_discrepancy: string | null
          aade_staging_row_id: string | null
          account_id: string | null
          ai_confidence: Json | null
          category_id: string | null
          collection_probability: number | null
          contact_id: string | null
          counterparty_afm: string | null
          counterparty_name: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          direction: Database["public"]["Enums"]["tx_direction"]
          document_type: string | null
          due_date: string | null
          fingerprint: string | null
          gross_amount: number
          has_invoice: boolean
          id: string
          installment_no: number | null
          invoice_number: string | null
          legacy_excel_id: string | null
          month_key: string | null
          mydata_mark: string | null
          net_amount: number | null
          notes: string | null
          org_id: string
          origin: Database["public"]["Enums"]["tx_origin"]
          other_taxes: number
          paid_on: string | null
          plan_id: string | null
          project_id: string | null
          scope: Database["public"]["Enums"]["tx_scope"]
          signed_amount: number | null
          source_document_id: string | null
          status: Database["public"]["Enums"]["tx_status"]
          tx_date: string
          updated_at: string
          vat_amount: number
          vat_rate: number | null
          withholding_amount: number
        }
        Insert: {
          aade_discrepancy?: string | null
          aade_staging_row_id?: string | null
          account_id?: string | null
          ai_confidence?: Json | null
          category_id?: string | null
          collection_probability?: number | null
          contact_id?: string | null
          counterparty_afm?: string | null
          counterparty_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          direction: Database["public"]["Enums"]["tx_direction"]
          document_type?: string | null
          due_date?: string | null
          fingerprint?: string | null
          gross_amount: number
          has_invoice?: boolean
          id?: string
          installment_no?: number | null
          invoice_number?: string | null
          legacy_excel_id?: string | null
          month_key?: string | null
          mydata_mark?: string | null
          net_amount?: number | null
          notes?: string | null
          org_id: string
          origin?: Database["public"]["Enums"]["tx_origin"]
          other_taxes?: number
          paid_on?: string | null
          plan_id?: string | null
          project_id?: string | null
          scope?: Database["public"]["Enums"]["tx_scope"]
          signed_amount?: number | null
          source_document_id?: string | null
          status?: Database["public"]["Enums"]["tx_status"]
          tx_date: string
          updated_at?: string
          vat_amount?: number
          vat_rate?: number | null
          withholding_amount?: number
        }
        Update: {
          aade_discrepancy?: string | null
          aade_staging_row_id?: string | null
          account_id?: string | null
          ai_confidence?: Json | null
          category_id?: string | null
          collection_probability?: number | null
          contact_id?: string | null
          counterparty_afm?: string | null
          counterparty_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          direction?: Database["public"]["Enums"]["tx_direction"]
          document_type?: string | null
          due_date?: string | null
          fingerprint?: string | null
          gross_amount?: number
          has_invoice?: boolean
          id?: string
          installment_no?: number | null
          invoice_number?: string | null
          legacy_excel_id?: string | null
          month_key?: string | null
          mydata_mark?: string | null
          net_amount?: number | null
          notes?: string | null
          org_id?: string
          origin?: Database["public"]["Enums"]["tx_origin"]
          other_taxes?: number
          paid_on?: string | null
          plan_id?: string | null
          project_id?: string | null
          scope?: Database["public"]["Enums"]["tx_scope"]
          signed_amount?: number | null
          source_document_id?: string | null
          status?: Database["public"]["Enums"]["tx_status"]
          tx_date?: string
          updated_at?: string
          vat_amount?: number
          vat_rate?: number | null
          withholding_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_aade_staging_row_id_fkey"
            columns: ["aade_staging_row_id"]
            isOneToOne: false
            referencedRelation: "aade_staging_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_contact_rollup"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "transactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_qc_contacts_missing_afm"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "transactions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "v_plan_progress"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "transactions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      vat_periods: {
        Row: {
          amount_paid: number | null
          created_at: string
          filed_on: string | null
          id: string
          locked: boolean
          locked_vat_expense: number | null
          locked_vat_income: number | null
          notes: string | null
          org_id: string
          paid_on: string | null
          period_end: string
          period_start: string
          reference: string | null
          status: Database["public"]["Enums"]["filing_status"]
          updated_at: string
        }
        Insert: {
          amount_paid?: number | null
          created_at?: string
          filed_on?: string | null
          id?: string
          locked?: boolean
          locked_vat_expense?: number | null
          locked_vat_income?: number | null
          notes?: string | null
          org_id: string
          paid_on?: string | null
          period_end: string
          period_start: string
          reference?: string | null
          status?: Database["public"]["Enums"]["filing_status"]
          updated_at?: string
        }
        Update: {
          amount_paid?: number | null
          created_at?: string
          filed_on?: string | null
          id?: string
          locked?: boolean
          locked_vat_expense?: number | null
          locked_vat_income?: number | null
          notes?: string | null
          org_id?: string
          paid_on?: string | null
          period_end?: string
          period_start?: string
          reference?: string | null
          status?: Database["public"]["Enums"]["filing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vat_periods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vat_periods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      withholding_periods: {
        Row: {
          amount_paid: number | null
          created_at: string
          filed_on: string | null
          id: string
          locked: boolean
          locked_withholding: number | null
          notes: string | null
          org_id: string
          paid_on: string | null
          period_end: string
          period_start: string
          reference: string | null
          status: Database["public"]["Enums"]["filing_status"]
          updated_at: string
        }
        Insert: {
          amount_paid?: number | null
          created_at?: string
          filed_on?: string | null
          id?: string
          locked?: boolean
          locked_withholding?: number | null
          notes?: string | null
          org_id: string
          paid_on?: string | null
          period_end: string
          period_start: string
          reference?: string | null
          status?: Database["public"]["Enums"]["filing_status"]
          updated_at?: string
        }
        Update: {
          amount_paid?: number | null
          created_at?: string
          filed_on?: string | null
          id?: string
          locked?: boolean
          locked_withholding?: number | null
          notes?: string | null
          org_id?: string
          paid_on?: string | null
          period_end?: string
          period_start?: string
          reference?: string | null
          status?: Database["public"]["Enums"]["filing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "withholding_periods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withholding_periods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
    }
    Views: {
      v_account_balances: {
        Row: {
          account_id: string | null
          current_balance: number | null
          is_liquid: boolean | null
          kind: Database["public"]["Enums"]["account_kind"] | null
          name: string | null
          opening_balance: number | null
          opening_balance_date: string | null
          org_id: string | null
          owner_scope: Database["public"]["Enums"]["owner_scope"] | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_cashflow_monthly: {
        Row: {
          inflow: number | null
          month: string | null
          org_id: string | null
          outflow: number | null
          owner_scope: Database["public"]["Enums"]["owner_scope"] | null
          weighted_expected_inflow: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_contact_rollup: {
        Row: {
          afm: string | null
          contact_id: string | null
          name: string | null
          net_balance: number | null
          org_id: string | null
          outstanding: number | null
          total_expense: number | null
          total_income: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_net_worth: {
        Row: {
          asset_total: number | null
          liability_total: number | null
          liquid_total: number | null
          org_id: string | null
        }
        Insert: {
          asset_total?: never
          liability_total?: never
          liquid_total?: never
          org_id?: string | null
        }
        Update: {
          asset_total?: never
          liability_total?: never
          liquid_total?: never
          org_id?: string | null
        }
        Relationships: []
      }
      v_plan_progress: {
        Row: {
          installments_total: number | null
          label: string | null
          last_paid_date: string | null
          next_due_date: string | null
          org_id: string | null
          overdue_amount: number | null
          overdue_count: number | null
          paid_amount: number | null
          paid_count: number | null
          plan_id: string | null
          remaining_amount: number | null
          status: Database["public"]["Enums"]["plan_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_project_rollup: {
        Row: {
          business_model: Database["public"]["Enums"]["business_model"] | null
          capex_committed: number | null
          capex_paid: number | null
          code: string | null
          display_name: string | null
          income_expected: number | null
          income_received: number | null
          occupancy_cost: number | null
          org_id: string | null
          other_opex: number | null
          pending: number | null
          project_id: string | null
          remaining_budget: number | null
          scheduled: number | null
          spent: number | null
          status: Database["public"]["Enums"]["project_status"] | null
          total_budget: number | null
          unclassified_spend: number | null
          vat_on_expenses: number | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_afm_mismatch: {
        Row: {
          contact_afm: string | null
          contact_name: string | null
          counterparty_afm: string | null
          description: string | null
          org_id: string | null
          transaction_id: string | null
          tx_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_amount_identity_mismatch: {
        Row: {
          contact_name: string | null
          description: string | null
          expected_gross: number | null
          gross_amount: number | null
          org_id: string | null
          transaction_id: string | null
          tx_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_capex_to_lessor: {
        Row: {
          contact_name: string | null
          gross_amount: number | null
          org_id: string | null
          project_id: string | null
          project_name: string | null
          transaction_id: string | null
          tx_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      v_qc_contacts_missing_afm: {
        Row: {
          contact_id: string | null
          email: string | null
          name: string | null
          org_id: string | null
          phone: string | null
        }
        Insert: {
          contact_id?: string | null
          email?: string | null
          name?: string | null
          org_id?: string | null
          phone?: string | null
        }
        Update: {
          contact_id?: string | null
          email?: string | null
          name?: string | null
          org_id?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_duplicate_contact_afm: {
        Row: {
          afm: string | null
          contact_ids: string[] | null
          contact_names: string[] | null
          n: number | null
          org_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_duplicate_fingerprints: {
        Row: {
          amounts: number[] | null
          contact_names: string[] | null
          fingerprint: string | null
          n: number | null
          org_id: string | null
          transaction_ids: string[] | null
          tx_dates: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_duplicate_invoice_numbers: {
        Row: {
          amounts: number[] | null
          contact_names: string[] | null
          invoice_number: string | null
          n: number | null
          org_id: string | null
          transaction_ids: string[] | null
          tx_dates: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_future_dated: {
        Row: {
          contact_name: string | null
          description: string | null
          gross_amount: number | null
          org_id: string | null
          transaction_id: string | null
          tx_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_missing_project_or_account: {
        Row: {
          contact_name: string | null
          description: string | null
          gross_amount: number | null
          missing_account: boolean | null
          missing_project: boolean | null
          org_id: string | null
          transaction_id: string | null
          tx_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_non_positive_amounts: {
        Row: {
          contact_name: string | null
          description: string | null
          direction: Database["public"]["Enums"]["tx_direction"] | null
          gross_amount: number | null
          org_id: string | null
          transaction_id: string | null
          tx_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_projects_without_budget: {
        Row: {
          code: string | null
          display_name: string | null
          org_id: string | null
          project_id: string | null
        }
        Insert: {
          code?: string | null
          display_name?: string | null
          org_id?: string | null
          project_id?: string | null
        }
        Update: {
          code?: string | null
          display_name?: string | null
          org_id?: string | null
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_spend_without_treatment: {
        Row: {
          description: string | null
          gross_amount: number | null
          org_id: string | null
          project_id: string | null
          project_name: string | null
          transaction_id: string | null
          tx_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_rollup"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_qc_projects_without_budget"
            referencedColumns: ["project_id"]
          },
        ]
      }
      v_qc_vat_mismatch: {
        Row: {
          contact_name: string | null
          description: string | null
          expected_vat: number | null
          net_amount: number | null
          org_id: string | null
          transaction_id: string | null
          tx_date: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_qc_withholding_on_income: {
        Row: {
          contact_name: string | null
          description: string | null
          org_id: string | null
          transaction_id: string | null
          tx_date: string | null
          withholding_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_vat_position: {
        Row: {
          credit_balance: number | null
          filing_deadline: string | null
          net_position: number | null
          org_id: string | null
          payable_after_credit: number | null
          period_start: string | null
          vat_expense: number | null
          vat_income: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
      v_withholding_position: {
        Row: {
          org_id: string | null
          period_start: string | null
          withheld_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "v_net_worth"
            referencedColumns: ["org_id"]
          },
        ]
      }
    }
    Functions: {
      ensure_plans_current: { Args: { p_org_id?: string }; Returns: undefined }
      has_role: {
        Args: { p_min: Database["public"]["Enums"]["org_role"]; p_org: string }
        Returns: boolean
      }
      my_org_ids: { Args: never; Returns: string[] }
      normalize_greek_name: { Args: { p_name: string }; Returns: string }
      regenerate_plan: {
        Args: { p_plan_id: string }
        Returns: {
          generated_count: number
          protected_count: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
      v_due_within: {
        Args: { p_days: number; p_org_id: string }
        Returns: {
          total_amount: number
        }[]
      }
    }
    Enums: {
      aade_batch_status: "draft" | "committed" | "discarded"
      aade_decision: "import" | "skip"
      aade_dedup_status:
        | "new"
        | "dup_mark"
        | "dup_fingerprint"
        | "dup_self_classification"
        | "dup_in_batch"
      aade_kind: "expenses" | "income"
      account_kind: "bank" | "cash" | "gold" | "crypto" | "other"
      agent_change_op: "insert" | "update" | "delete"
      agent_change_status: "pending" | "approved" | "rejected"
      asset_state: "held" | "pending_inheritance"
      budget_line_code:
        | "acquisition"
        | "studies_permits_legal"
        | "construction_equipment"
        | "other"
      business_model:
        | "own_development"
        | "client_project"
        | "hotel_lease"
        | "general"
      certainty: "certain" | "probable"
      cost_treatment:
        | "capex"
        | "opex"
        | "rent"
        | "rent_substitute"
        | "financing"
        | "tax"
        | "vat"
        | "pass_through"
        | "income"
      filing_status: "pending" | "filed" | "paid" | "cancelled"
      liability_kind: "private" | "bank"
      liability_state: "in_application" | "approved" | "disbursed" | "repaid"
      obligation_kind:
        | "rent"
        | "third_party_tax_settlement"
        | "supplier"
        | "own_tax"
        | "loan"
        | "other"
      org_role: "owner" | "admin" | "editor" | "viewer"
      owner_scope: "corporate" | "personal"
      plan_frequency: "monthly" | "quarterly" | "semiannual" | "annual"
      plan_status: "active" | "completed" | "cancelled"
      project_status: "offer" | "active" | "on_hold" | "completed" | "cancelled"
      project_type:
        | "construction"
        | "installation"
        | "renovation"
        | "hospitality"
        | "general"
      tx_direction: "income" | "expense"
      tx_origin: "aade" | "manual" | "bank_file" | "ai_document" | "ai_nl"
      tx_scope: "business" | "personal"
      tx_status: "paid" | "pending" | "scheduled" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      aade_batch_status: ["draft", "committed", "discarded"],
      aade_decision: ["import", "skip"],
      aade_dedup_status: [
        "new",
        "dup_mark",
        "dup_fingerprint",
        "dup_self_classification",
        "dup_in_batch",
      ],
      aade_kind: ["expenses", "income"],
      account_kind: ["bank", "cash", "gold", "crypto", "other"],
      agent_change_op: ["insert", "update", "delete"],
      agent_change_status: ["pending", "approved", "rejected"],
      asset_state: ["held", "pending_inheritance"],
      budget_line_code: [
        "acquisition",
        "studies_permits_legal",
        "construction_equipment",
        "other",
      ],
      business_model: [
        "own_development",
        "client_project",
        "hotel_lease",
        "general",
      ],
      certainty: ["certain", "probable"],
      cost_treatment: [
        "capex",
        "opex",
        "rent",
        "rent_substitute",
        "financing",
        "tax",
        "vat",
        "pass_through",
        "income",
      ],
      filing_status: ["pending", "filed", "paid", "cancelled"],
      liability_kind: ["private", "bank"],
      liability_state: ["in_application", "approved", "disbursed", "repaid"],
      obligation_kind: [
        "rent",
        "third_party_tax_settlement",
        "supplier",
        "own_tax",
        "loan",
        "other",
      ],
      org_role: ["owner", "admin", "editor", "viewer"],
      owner_scope: ["corporate", "personal"],
      plan_frequency: ["monthly", "quarterly", "semiannual", "annual"],
      plan_status: ["active", "completed", "cancelled"],
      project_status: ["offer", "active", "on_hold", "completed", "cancelled"],
      project_type: [
        "construction",
        "installation",
        "renovation",
        "hospitality",
        "general",
      ],
      tx_direction: ["income", "expense"],
      tx_origin: ["aade", "manual", "bank_file", "ai_document", "ai_nl"],
      tx_scope: ["business", "personal"],
      tx_status: ["paid", "pending", "scheduled", "cancelled"],
    },
  },
} as const
