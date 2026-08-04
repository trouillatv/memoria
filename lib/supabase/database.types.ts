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
  public: {
    Tables: {
      _migrations_applied: {
        Row: {
          applied_at: string
          filename: string
        }
        Insert: {
          applied_at?: string
          filename: string
        }
        Update: {
          applied_at?: string
          filename?: string
        }
        Relationships: []
      }
      action_distribution_items: {
        Row: {
          action_id: string
          created_at: string
          declared_at: string | null
          declared_comment: string | null
          declared_photo_path: string | null
          declared_status: string
          distribution_id: string
          requires_proof_photo: boolean
        }
        Insert: {
          action_id: string
          created_at?: string
          declared_at?: string | null
          declared_comment?: string | null
          declared_photo_path?: string | null
          declared_status?: string
          distribution_id: string
          requires_proof_photo?: boolean
        }
        Update: {
          action_id?: string
          created_at?: string
          declared_at?: string | null
          declared_comment?: string | null
          declared_photo_path?: string | null
          declared_status?: string
          distribution_id?: string
          requires_proof_photo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "action_distribution_items_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "site_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_distribution_items_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "action_distributions"
            referencedColumns: ["id"]
          },
        ]
      }
      action_distributions: {
        Row: {
          access_count: number
          accessed_at: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          note: string | null
          recipient_label: string
          report_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          signature_data_url: string | null
          site_id: string
          submitted_at: string | null
          submitted_by_name: string | null
          token: string
        }
        Insert: {
          access_count?: number
          accessed_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          note?: string | null
          recipient_label: string
          report_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          signature_data_url?: string | null
          site_id: string
          submitted_at?: string | null
          submitted_by_name?: string | null
          token: string
        }
        Update: {
          access_count?: number
          accessed_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          note?: string | null
          recipient_label?: string
          report_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          signature_data_url?: string | null
          site_id?: string
          submitted_at?: string | null
          submitted_by_name?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_distributions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_distributions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_distributions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          organization_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          cost_usd: number | null
          created_at: string | null
          duration_ms: number | null
          error_msg: string | null
          feature: string
          id: string
          input_tokens: number | null
          model: string | null
          organization_id: string | null
          output_tokens: number | null
          provider: Database["public"]["Enums"]["ai_provider"]
          status: string
          user_id: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string | null
          duration_ms?: number | null
          error_msg?: string | null
          feature: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          organization_id?: string | null
          output_tokens?: number | null
          provider: Database["public"]["Enums"]["ai_provider"]
          status: string
          user_id?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string | null
          duration_ms?: number | null
          error_msg?: string | null
          feature?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          organization_id?: string | null
          output_tokens?: number | null
          provider?: Database["public"]["Enums"]["ai_provider"]
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      captured_knowledge: {
        Row: {
          action_id: string | null
          body: string | null
          created_at: string
          created_by: string | null
          dismiss_reason: string | null
          dossier_id: string | null
          id: string
          kind: string
          organization_id: string | null
          replaced_by: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          site_id: string
          source_capture_ids: string[]
          source_id: string | null
          source_type: string
          status: string
          subject_id: string | null
          title: string
          tsv: unknown
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          action_id?: string | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          dismiss_reason?: string | null
          dossier_id?: string | null
          id?: string
          kind?: string
          organization_id?: string | null
          replaced_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          site_id: string
          source_capture_ids?: string[]
          source_id?: string | null
          source_type?: string
          status?: string
          subject_id?: string | null
          title: string
          tsv?: unknown
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          action_id?: string | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          dismiss_reason?: string | null
          dossier_id?: string | null
          id?: string
          kind?: string
          organization_id?: string | null
          replaced_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          site_id?: string
          source_capture_ids?: string[]
          source_id?: string | null
          source_type?: string
          status?: string
          subject_id?: string | null
          title?: string
          tsv?: unknown
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "captured_knowledge_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "site_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_knowledge_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_knowledge_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_knowledge_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "captured_knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_knowledge_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_knowledge_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captured_knowledge_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          logo_path: string | null
          logo_updated_at: string | null
          name: string
          notes: string | null
          organization_id: string | null
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          logo_path?: string | null
          logo_updated_at?: string | null
          name: string
          notes?: string | null
          organization_id?: string | null
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          logo_path?: string | null
          logo_updated_at?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      closure_conflict_decision: {
        Row: {
          closure_id: string
          conflict_date: string
          decided_at: string
          decided_by: string | null
          decision: string
          id: string
          intervention_id: string
          moved_to: string | null
        }
        Insert: {
          closure_id: string
          conflict_date: string
          decided_at?: string
          decided_by?: string | null
          decision: string
          id?: string
          intervention_id: string
          moved_to?: string | null
        }
        Update: {
          closure_id?: string
          conflict_date?: string
          decided_at?: string
          decided_by?: string | null
          decision?: string
          id?: string
          intervention_id?: string
          moved_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "closure_conflict_decision_closure_id_fkey"
            columns: ["closure_id"]
            isOneToOne: false
            referencedRelation: "site_closures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closure_conflict_decision_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closure_conflict_decision_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          is_placeholder: boolean
          logo_url: string | null
          name: string
          notes: string | null
          organization_id: string | null
          phone: string | null
          postal_code: string | null
          short_name: string | null
          siret: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_placeholder?: boolean
          logo_url?: string | null
          name: string
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          postal_code?: string | null
          short_name?: string | null
          siret?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_placeholder?: boolean
          logo_url?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          postal_code?: string | null
          short_name?: string | null
          siret?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_contacts: {
        Row: {
          company_id: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          full_name: string
          function: string | null
          id: string
          is_internal_agent: boolean
          is_main: boolean
          mobile: string | null
          organization_id: string
          phone: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name: string
          function?: string | null
          id?: string
          is_internal_agent?: boolean
          is_main?: boolean
          mobile?: string | null
          organization_id: string
          phone?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name?: string
          function?: string | null
          id?: string
          is_internal_agent?: boolean
          is_main?: boolean
          mobile?: string | null
          organization_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      comprehension_affirmations: {
        Row: {
          category: string
          created_at: string
          id: string
          ordinal: number
          organization_id: string | null
          provenance: Json
          run_id: string
          text: string
          verdict: string | null
          verdict_at: string | null
          verdict_by: string | null
          verdict_note: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          ordinal?: number
          organization_id?: string | null
          provenance?: Json
          run_id: string
          text: string
          verdict?: string | null
          verdict_at?: string | null
          verdict_by?: string | null
          verdict_note?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          ordinal?: number
          organization_id?: string | null
          provenance?: Json
          run_id?: string
          text?: string
          verdict?: string | null
          verdict_at?: string | null
          verdict_by?: string | null
          verdict_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comprehension_affirmations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "comprehension_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprehension_affirmations_verdict_by_fkey"
            columns: ["verdict_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      comprehension_runs: {
        Row: {
          created_at: string
          created_by: string | null
          dossier_id: string
          global_verdict: string | null
          global_verdict_at: string | null
          global_verdict_by: string | null
          id: string
          missing_note: string | null
          model: string | null
          organization_id: string | null
          provider: string | null
          site_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dossier_id: string
          global_verdict?: string | null
          global_verdict_at?: string | null
          global_verdict_by?: string | null
          id?: string
          missing_note?: string | null
          model?: string | null
          organization_id?: string | null
          provider?: string | null
          site_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dossier_id?: string
          global_verdict?: string | null
          global_verdict_at?: string | null
          global_verdict_by?: string | null
          id?: string
          missing_note?: string | null
          model?: string | null
          organization_id?: string | null
          provider?: string | null
          site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comprehension_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprehension_runs_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprehension_runs_global_verdict_by_fkey"
            columns: ["global_verdict_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          client_name: string
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          end_date: string | null
          frequence: string | null
          id: string
          name: string
          organization_id: string | null
          start_date: string
          status: Database["public"]["Enums"]["contract_status"]
          tender_id: string | null
          updated_at: string | null
          volume_horaire_mensuel: number | null
        }
        Insert: {
          client_name: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          end_date?: string | null
          frequence?: string | null
          id?: string
          name: string
          organization_id?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["contract_status"]
          tender_id?: string | null
          updated_at?: string | null
          volume_horaire_mensuel?: number | null
        }
        Update: {
          client_name?: string
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          end_date?: string | null
          frequence?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["contract_status"]
          tender_id?: string | null
          updated_at?: string | null
          volume_horaire_mensuel?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      document_collections: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          id: string
          name: string
          organization_id: string | null
          position: number
          scope_id: string | null
          scope_type: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          organization_id?: string | null
          position?: number
          scope_id?: string | null
          scope_type?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          position?: number
          scope_id?: string | null
          scope_type?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_collections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_diffs: {
        Row: {
          created_at: string
          final_version_id: string | null
          generated_report_document_id: string | null
          id: string
          report_id: string
          summary: Json | null
        }
        Insert: {
          created_at?: string
          final_version_id?: string | null
          generated_report_document_id?: string | null
          id?: string
          report_id: string
          summary?: Json | null
        }
        Update: {
          created_at?: string
          final_version_id?: string | null
          generated_report_document_id?: string | null
          id?: string
          report_id?: string
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "document_diffs_final_version_id_fkey"
            columns: ["final_version_id"]
            isOneToOne: false
            referencedRelation: "report_final_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_diffs_generated_report_document_id_fkey"
            columns: ["generated_report_document_id"]
            isOneToOne: false
            referencedRelation: "report_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_diffs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      document_extraction_evidence: {
        Row: {
          caption: string | null
          created_at: string
          document_id: string
          evidence_type: string
          extraction_run_id: string
          id: string
          metadata: Json | null
          nearby_text: string | null
          organization_id: string
          pinned_for_visit: boolean
          source_page: number | null
          storage_path: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          document_id: string
          evidence_type: string
          extraction_run_id: string
          id?: string
          metadata?: Json | null
          nearby_text?: string | null
          organization_id: string
          pinned_for_visit?: boolean
          source_page?: number | null
          storage_path?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          document_id?: string
          evidence_type?: string
          extraction_run_id?: string
          id?: string
          metadata?: Json | null
          nearby_text?: string | null
          organization_id?: string
          pinned_for_visit?: boolean
          source_page?: number | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_extraction_evidence_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extraction_evidence_extraction_run_id_fkey"
            columns: ["extraction_run_id"]
            isOneToOne: false
            referencedRelation: "document_extraction_run"
            referencedColumns: ["id"]
          },
        ]
      }
      document_extraction_proposal: {
        Row: {
          created_at: string
          description: string | null
          document_id: string
          document_status: string | null
          extraction_run_id: string
          id: string
          label: string
          organization_id: string
          proposal_family: string
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_description: string | null
          reviewed_family: string | null
          reviewed_label: string | null
          source_excerpt: string | null
          source_page: number | null
          source_payload: Json | null
          stable_key: string | null
          subject_thread_id: string | null
          target_site_id: string | null
          thematic_category: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          document_id: string
          document_status?: string | null
          extraction_run_id: string
          id?: string
          label: string
          organization_id: string
          proposal_family: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_description?: string | null
          reviewed_family?: string | null
          reviewed_label?: string | null
          source_excerpt?: string | null
          source_page?: number | null
          source_payload?: Json | null
          stable_key?: string | null
          subject_thread_id?: string | null
          target_site_id?: string | null
          thematic_category?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          document_id?: string
          document_status?: string | null
          extraction_run_id?: string
          id?: string
          label?: string
          organization_id?: string
          proposal_family?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_description?: string | null
          reviewed_family?: string | null
          reviewed_label?: string | null
          source_excerpt?: string | null
          source_page?: number | null
          source_payload?: Json | null
          stable_key?: string | null
          subject_thread_id?: string | null
          target_site_id?: string | null
          thematic_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_extraction_proposal_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extraction_proposal_extraction_run_id_fkey"
            columns: ["extraction_run_id"]
            isOneToOne: false
            referencedRelation: "document_extraction_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extraction_proposal_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extraction_proposal_target_site_id_fkey"
            columns: ["target_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      document_extraction_run: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          current_stage: string | null
          document_id: string
          error_message: string | null
          extractor_key: string
          extractor_version: string
          id: string
          organization_id: string
          started_at: string | null
          status: string
          target_site_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?: string | null
          document_id: string
          error_message?: string | null
          extractor_key: string
          extractor_version?: string
          id?: string
          organization_id: string
          started_at?: string | null
          status?: string
          target_site_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?: string | null
          document_id?: string
          error_message?: string | null
          extractor_key?: string
          extractor_version?: string
          id?: string
          organization_id?: string
          started_at?: string | null
          status?: string
          target_site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_extraction_run_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extraction_run_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extraction_run_target_site_id_fkey"
            columns: ["target_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      document_links: {
        Row: {
          created_at: string | null
          document_id: string
          id: string
          reference_label: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string | null
          document_id: string
          id?: string
          reference_label?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string | null
          document_id?: string
          id?: string
          reference_label?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_proposal_evidence: {
        Row: {
          confidence: number | null
          created_at: string
          evidence_id: string
          proposal_id: string
          relation_type: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence_id: string
          proposal_id: string
          relation_type: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence_id?: string
          proposal_id?: string
          relation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_proposal_evidence_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "document_extraction_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_proposal_evidence_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "document_extraction_proposal"
            referencedColumns: ["id"]
          },
        ]
      }
      document_proposal_materialization: {
        Row: {
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          organization_id: string
          proposal_id: string
          status: string
          target_entity_id: string
          target_entity_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          proposal_id: string
          status?: string
          target_entity_id: string
          target_entity_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          proposal_id?: string
          status?: string
          target_entity_id?: string
          target_entity_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_proposal_materialization_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_proposal_materialization_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "document_extraction_proposal"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          analysis_status: string
          collection_id: string | null
          content_hash: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          document_type: string
          effective_date: string | null
          expires_date: string | null
          extracted_text: string | null
          extraction_source: string | null
          failed_reason: string | null
          filename: string
          id: string
          memory_tier: string | null
          organization_id: string | null
          page_count: number | null
          size_bytes: number | null
          status: string
          storage_path: string
          supersedes_document_id: string | null
          tags: string[]
          tenant_id: string | null
          tsv: unknown
          updated_at: string | null
          visibility_level: string
        }
        Insert: {
          analysis_status?: string
          collection_id?: string | null
          content_hash?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          document_type: string
          effective_date?: string | null
          expires_date?: string | null
          extracted_text?: string | null
          extraction_source?: string | null
          failed_reason?: string | null
          filename: string
          id?: string
          memory_tier?: string | null
          organization_id?: string | null
          page_count?: number | null
          size_bytes?: number | null
          status?: string
          storage_path: string
          supersedes_document_id?: string | null
          tags?: string[]
          tenant_id?: string | null
          tsv?: unknown
          updated_at?: string | null
          visibility_level?: string
        }
        Update: {
          analysis_status?: string
          collection_id?: string | null
          content_hash?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          document_type?: string
          effective_date?: string | null
          expires_date?: string | null
          extracted_text?: string | null
          extraction_source?: string | null
          failed_reason?: string | null
          filename?: string
          id?: string
          memory_tier?: string | null
          organization_id?: string | null
          page_count?: number | null
          size_bytes?: number | null
          status?: string
          storage_path?: string
          supersedes_document_id?: string | null
          tags?: string[]
          tenant_id?: string | null
          tsv?: unknown
          updated_at?: string | null
          visibility_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "document_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_supersedes_document_id_fkey"
            columns: ["supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      dossier_phase_events: {
        Row: {
          at: string
          created_at: string
          dossier_id: string
          id: string
          phase: string
          site_id: string | null
        }
        Insert: {
          at?: string
          created_at?: string
          dossier_id: string
          id?: string
          phase: string
          site_id?: string | null
        }
        Update: {
          at?: string
          created_at?: string
          dossier_id?: string
          id?: string
          phase?: string
          site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dossier_phase_events_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossier_phase_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      dossiers: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          label: string | null
          opened_at: string
          organization_id: string | null
          phase: string
          site_id: string
          type: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          label?: string | null
          opened_at?: string
          organization_id?: string | null
          phase?: string
          site_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          label?: string | null
          opened_at?: string
          organization_id?: string | null
          phase?: string
          site_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dossiers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossiers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dossiers_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      engagements: {
        Row: {
          ai_confidence: number | null
          category: Database["public"]["Enums"]["engagement_category"]
          contract_id: string | null
          created_at: string | null
          created_by: string | null
          destination: string
          id: string
          kind: string | null
          measurable: boolean
          organization_id: string | null
          page_number: number | null
          proof_requirement: string
          short_label: string
          source_excerpt: string
          source_ref: Json | null
          source_type: Database["public"]["Enums"]["engagement_source_type"]
          status: Database["public"]["Enums"]["engagement_status"]
          tender_document_id: string | null
          tender_id: string
          updated_at: string | null
        }
        Insert: {
          ai_confidence?: number | null
          category: Database["public"]["Enums"]["engagement_category"]
          contract_id?: string | null
          created_at?: string | null
          created_by?: string | null
          destination?: string
          id?: string
          kind?: string | null
          measurable?: boolean
          organization_id?: string | null
          page_number?: number | null
          proof_requirement?: string
          short_label: string
          source_excerpt: string
          source_ref?: Json | null
          source_type: Database["public"]["Enums"]["engagement_source_type"]
          status?: Database["public"]["Enums"]["engagement_status"]
          tender_document_id?: string | null
          tender_id: string
          updated_at?: string | null
        }
        Update: {
          ai_confidence?: number | null
          category?: Database["public"]["Enums"]["engagement_category"]
          contract_id?: string | null
          created_at?: string | null
          created_by?: string | null
          destination?: string
          id?: string
          kind?: string | null
          measurable?: boolean
          organization_id?: string | null
          page_number?: number | null
          proof_requirement?: string
          short_label?: string
          source_excerpt?: string
          source_ref?: Json | null
          source_type?: Database["public"]["Enums"]["engagement_source_type"]
          status?: Database["public"]["Enums"]["engagement_status"]
          tender_document_id?: string | null
          tender_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagements_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagements_tender_document_tender_id_fkey"
            columns: ["tender_id", "tender_document_id"]
            isOneToOne: false
            referencedRelation: "tender_documents"
            referencedColumns: ["tender_id", "id"]
          },
          {
            foreignKeyName: "engagements_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          admin_reply: string | null
          admin_reply_at: string | null
          admin_reply_by: string | null
          attachment_paths: string[]
          created_at: string
          id: string
          message: string
          page: string | null
          reply_seen_at: string | null
          status: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          admin_reply?: string | null
          admin_reply_at?: string | null
          admin_reply_by?: string | null
          attachment_paths?: string[]
          created_at?: string
          id?: string
          message: string
          page?: string | null
          reply_seen_at?: string | null
          status?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          admin_reply?: string | null
          admin_reply_at?: string | null
          admin_reply_by?: string | null
          attachment_paths?: string[]
          created_at?: string
          id?: string
          message?: string
          page?: string | null
          reply_seen_at?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_admin_reply_by_fkey"
            columns: ["admin_reply_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      glossary_terms: {
        Row: {
          aliases: string[]
          category: string | null
          created_at: string
          created_by: string | null
          definition: string | null
          id: string
          organization_id: string | null
          term: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          category?: string | null
          created_at?: string
          created_by?: string | null
          definition?: string | null
          id?: string
          organization_id?: string | null
          term: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          category?: string | null
          created_at?: string
          created_by?: string | null
          definition?: string | null
          id?: string
          organization_id?: string | null
          term?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "glossary_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_briefs: {
        Row: {
          access_count: number
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          effective_date: string | null
          expires_at: string | null
          id: string
          kind: string
          last_accessed_at: string | null
          organization_id: string | null
          payload: Json
          shared_at: string | null
          shared_token: string | null
          site_id: string | null
          source_team_id: string | null
          status: string
          subject_user_id: string | null
          target_team_id: string | null
          title: string
        }
        Insert: {
          access_count?: number
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_date?: string | null
          expires_at?: string | null
          id?: string
          kind: string
          last_accessed_at?: string | null
          organization_id?: string | null
          payload: Json
          shared_at?: string | null
          shared_token?: string | null
          site_id?: string | null
          source_team_id?: string | null
          status?: string
          subject_user_id?: string | null
          target_team_id?: string | null
          title: string
        }
        Update: {
          access_count?: number
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_date?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          last_accessed_at?: string | null
          organization_id?: string | null
          payload?: Json
          shared_at?: string | null
          shared_token?: string | null
          site_id?: string | null
          source_team_id?: string | null
          status?: string
          subject_user_id?: string | null
          target_team_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "handover_briefs_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_briefs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_briefs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_briefs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_briefs_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_briefs_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_briefs_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_access_events: {
        Row: {
          anomaly_id: string | null
          created_at: string
          created_by: string | null
          deferred: boolean
          id: string
          intervention_id: string
          note: string | null
          occurred_at: string
          photo_id: string | null
          requires_return: boolean
          source: Database["public"]["Enums"]["access_event_source"]
          type: Database["public"]["Enums"]["access_event_type"]
        }
        Insert: {
          anomaly_id?: string | null
          created_at?: string
          created_by?: string | null
          deferred?: boolean
          id?: string
          intervention_id: string
          note?: string | null
          occurred_at?: string
          photo_id?: string | null
          requires_return?: boolean
          source?: Database["public"]["Enums"]["access_event_source"]
          type: Database["public"]["Enums"]["access_event_type"]
        }
        Update: {
          anomaly_id?: string | null
          created_at?: string
          created_by?: string | null
          deferred?: boolean
          id?: string
          intervention_id?: string
          note?: string | null
          occurred_at?: string
          photo_id?: string | null
          requires_return?: boolean
          source?: Database["public"]["Enums"]["access_event_source"]
          type?: Database["public"]["Enums"]["access_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "intervention_access_events_anomaly_id_fkey"
            columns: ["anomaly_id"]
            isOneToOne: false
            referencedRelation: "intervention_anomalies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_access_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_access_events_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_access_events_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "intervention_photos"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_anomalies: {
        Row: {
          category: string
          category_other: string | null
          created_at: string | null
          description: string | null
          engagement_id: string | null
          id: string
          intervention_id: string
          organization_id: string | null
          reported_by: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          scope_id: string | null
          status: Database["public"]["Enums"]["anomaly_status"]
          subject_id: string | null
          tsv: unknown
        }
        Insert: {
          category: string
          category_other?: string | null
          created_at?: string | null
          description?: string | null
          engagement_id?: string | null
          id?: string
          intervention_id: string
          organization_id?: string | null
          reported_by?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scope_id?: string | null
          status?: Database["public"]["Enums"]["anomaly_status"]
          subject_id?: string | null
          tsv?: unknown
        }
        Update: {
          category?: string
          category_other?: string | null
          created_at?: string | null
          description?: string | null
          engagement_id?: string | null
          id?: string
          intervention_id?: string
          organization_id?: string | null
          reported_by?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scope_id?: string | null
          status?: Database["public"]["Enums"]["anomaly_status"]
          subject_id?: string | null
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "intervention_anomalies_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_anomalies_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_anomalies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_anomalies_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_anomalies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_anomalies_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "memory_scopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_anomalies_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_checklist_items: {
        Row: {
          delivered_qty: number | null
          done: boolean
          done_at: string | null
          done_by: string | null
          engagement_id: string | null
          executed_at: string | null
          executed_by_token_id: string | null
          expected_qty: number | null
          id: string
          intervention_id: string
          item_status: string | null
          label: string
          organization_id: string | null
          origin_template_label: string | null
          position: number
          required: boolean
          source: string
        }
        Insert: {
          delivered_qty?: number | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          engagement_id?: string | null
          executed_at?: string | null
          executed_by_token_id?: string | null
          expected_qty?: number | null
          id?: string
          intervention_id: string
          item_status?: string | null
          label: string
          organization_id?: string | null
          origin_template_label?: string | null
          position?: number
          required?: boolean
          source?: string
        }
        Update: {
          delivered_qty?: number | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          engagement_id?: string | null
          executed_at?: string | null
          executed_by_token_id?: string | null
          expected_qty?: number | null
          id?: string
          intervention_id?: string
          item_status?: string | null
          label?: string
          organization_id?: string | null
          origin_template_label?: string | null
          position?: number
          required?: boolean
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_checklist_items_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_checklist_items_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_checklist_items_executed_by_token_id_fkey"
            columns: ["executed_by_token_id"]
            isOneToOne: false
            referencedRelation: "intervention_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_checklist_items_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_companies: {
        Row: {
          company_name: string
          created_at: string
          created_by: string | null
          id: string
          intervention_id: string
          organization_id: string | null
          role_description: string | null
        }
        Insert: {
          company_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          intervention_id: string
          organization_id?: string | null
          role_description?: string | null
        }
        Update: {
          company_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          intervention_id?: string
          organization_id?: string | null
          role_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intervention_companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_companies_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_participants: {
        Row: {
          created_at: string
          created_by: string | null
          intervention_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          intervention_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          intervention_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_participants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_participants_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_photos: {
        Row: {
          ai_caption: string | null
          anomaly_id: string | null
          caption: string | null
          checklist_item_id: string | null
          client_timestamp: string | null
          client_uuid: string | null
          external_token_id: string | null
          hash_origin: string
          id: string
          intervention_id: string
          kind: Database["public"]["Enums"]["photo_kind"]
          mime_type: string | null
          organization_id: string | null
          scope_id: string | null
          sha256: string | null
          size_bytes: number | null
          storage_path: string
          taken_at: string
          taken_by: string | null
          tsv: unknown
        }
        Insert: {
          ai_caption?: string | null
          anomaly_id?: string | null
          caption?: string | null
          checklist_item_id?: string | null
          client_timestamp?: string | null
          client_uuid?: string | null
          external_token_id?: string | null
          hash_origin?: string
          id?: string
          intervention_id: string
          kind: Database["public"]["Enums"]["photo_kind"]
          mime_type?: string | null
          organization_id?: string | null
          scope_id?: string | null
          sha256?: string | null
          size_bytes?: number | null
          storage_path: string
          taken_at?: string
          taken_by?: string | null
          tsv?: unknown
        }
        Update: {
          ai_caption?: string | null
          anomaly_id?: string | null
          caption?: string | null
          checklist_item_id?: string | null
          client_timestamp?: string | null
          client_uuid?: string | null
          external_token_id?: string | null
          hash_origin?: string
          id?: string
          intervention_id?: string
          kind?: Database["public"]["Enums"]["photo_kind"]
          mime_type?: string | null
          organization_id?: string | null
          scope_id?: string | null
          sha256?: string | null
          size_bytes?: number | null
          storage_path?: string
          taken_at?: string
          taken_by?: string | null
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "intervention_photos_anomaly_id_fkey"
            columns: ["anomaly_id"]
            isOneToOne: false
            referencedRelation: "intervention_anomalies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_photos_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "intervention_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_photos_external_token_id_fkey"
            columns: ["external_token_id"]
            isOneToOne: false
            referencedRelation: "intervention_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_photos_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_photos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_photos_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "memory_scopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_photos_taken_by_fkey"
            columns: ["taken_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_templates: {
        Row: {
          active: boolean
          anchor_date: string | null
          assigned_team_id: string | null
          created_at: string
          created_by: string | null
          cycle_id: string | null
          cycle_length_weeks: number | null
          day_of_month: number | null
          day_of_week: number | null
          deleted_at: string | null
          description: string | null
          ends_on: string | null
          frequency: string
          id: string
          mission_id: string
          organization_id: string | null
          planned_end_hhmm: string | null
          planned_start_hhmm: string | null
          slots: string[] | null
          starts_on: string
          title: string
          week_index: number | null
        }
        Insert: {
          active?: boolean
          anchor_date?: string | null
          assigned_team_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_id?: string | null
          cycle_length_weeks?: number | null
          day_of_month?: number | null
          day_of_week?: number | null
          deleted_at?: string | null
          description?: string | null
          ends_on?: string | null
          frequency: string
          id?: string
          mission_id: string
          organization_id?: string | null
          planned_end_hhmm?: string | null
          planned_start_hhmm?: string | null
          slots?: string[] | null
          starts_on: string
          title: string
          week_index?: number | null
        }
        Update: {
          active?: boolean
          anchor_date?: string | null
          assigned_team_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_id?: string | null
          cycle_length_weeks?: number | null
          day_of_month?: number | null
          day_of_week?: number | null
          deleted_at?: string | null
          description?: string | null
          ends_on?: string | null
          frequency?: string
          id?: string
          mission_id?: string
          organization_id?: string | null
          planned_end_hhmm?: string | null
          planned_start_hhmm?: string | null
          slots?: string[] | null
          starts_on?: string
          title?: string
          week_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "intervention_templates_assigned_team_id_fkey"
            columns: ["assigned_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_templates_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "planning_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_templates_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_token_items: {
        Row: {
          checklist_item_id: string
          created_at: string
          token_id: string
        }
        Insert: {
          checklist_item_id: string
          created_at?: string
          token_id: string
        }
        Update: {
          checklist_item_id?: string
          created_at?: string
          token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_token_items_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "intervention_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_token_items_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "intervention_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_tokens: {
        Row: {
          access_count: number
          accessed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          intervention_id: string
          note: string | null
          permissions: string[]
          recipient_label: string | null
          revoked_at: string | null
          revoked_by: string | null
          signature_data_url: string | null
          signed_at: string | null
          token: string
          validated_at: string | null
          validated_by_name: string | null
          validation_comment: string | null
        }
        Insert: {
          access_count?: number
          accessed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          intervention_id: string
          note?: string | null
          permissions?: string[]
          recipient_label?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          token: string
          validated_at?: string | null
          validated_by_name?: string | null
          validation_comment?: string | null
        }
        Update: {
          access_count?: number
          accessed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          intervention_id?: string
          note?: string | null
          permissions?: string[]
          recipient_label?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          token?: string
          validated_at?: string | null
          validated_by_name?: string | null
          validation_comment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intervention_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_tokens_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_tokens_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_validations: {
        Row: {
          comment: string | null
          id: string
          intervention_id: string
          organization_id: string | null
          validated_at: string
          validated_by: string
        }
        Insert: {
          comment?: string | null
          id?: string
          intervention_id: string
          organization_id?: string | null
          validated_at?: string
          validated_by: string
        }
        Update: {
          comment?: string | null
          id?: string
          intervention_id?: string
          organization_id?: string | null
          validated_at?: string
          validated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_validations_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_validations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_validations_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      intervention_voice_notes: {
        Row: {
          duration_seconds: number
          extraction_proposed: Json | null
          extraction_validated: Json | null
          fragment_proposed: string | null
          fragment_validated: string | null
          id: string
          intervention_id: string
          mime_type: string
          recorded_at: string
          recorded_by: string | null
          site_id: string
          status: string
          storage_path: string
          tenant_id: string
          transcription_corrected: string | null
          transcription_raw: string | null
          transcription_status: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          duration_seconds: number
          extraction_proposed?: Json | null
          extraction_validated?: Json | null
          fragment_proposed?: string | null
          fragment_validated?: string | null
          id?: string
          intervention_id: string
          mime_type?: string
          recorded_at?: string
          recorded_by?: string | null
          site_id: string
          status?: string
          storage_path: string
          tenant_id: string
          transcription_corrected?: string | null
          transcription_raw?: string | null
          transcription_status?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          duration_seconds?: number
          extraction_proposed?: Json | null
          extraction_validated?: Json | null
          fragment_proposed?: string | null
          fragment_validated?: string | null
          id?: string
          intervention_id?: string
          mime_type?: string
          recorded_at?: string
          recorded_by?: string | null
          site_id?: string
          status?: string
          storage_path?: string
          tenant_id?: string
          transcription_corrected?: string | null
          transcription_raw?: string | null
          transcription_status?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intervention_voice_notes_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_voice_notes_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_voice_notes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_voice_notes_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      interventions: {
        Row: {
          assigned_team_id: string | null
          created_at: string | null
          created_by: string | null
          executed_at: string | null
          id: string
          label: string | null
          mission_id: string
          notes: string | null
          organization_id: string | null
          planned_end: string | null
          planned_start: string | null
          scheduled_at: string
          scheduled_for: string | null
          signature_data_url: string | null
          signed_at: string | null
          signed_by: string | null
          skipped_at: string | null
          skipped_by: string | null
          skipped_reason: string | null
          slot: string | null
          status: Database["public"]["Enums"]["intervention_status"]
          team: string[]
          template_id: string | null
          tsv: unknown
          updated_at: string | null
        }
        Insert: {
          assigned_team_id?: string | null
          created_at?: string | null
          created_by?: string | null
          executed_at?: string | null
          id?: string
          label?: string | null
          mission_id: string
          notes?: string | null
          organization_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          scheduled_at: string
          scheduled_for?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          signed_by?: string | null
          skipped_at?: string | null
          skipped_by?: string | null
          skipped_reason?: string | null
          slot?: string | null
          status?: Database["public"]["Enums"]["intervention_status"]
          team?: string[]
          template_id?: string | null
          tsv?: unknown
          updated_at?: string | null
        }
        Update: {
          assigned_team_id?: string | null
          created_at?: string | null
          created_by?: string | null
          executed_at?: string | null
          id?: string
          label?: string | null
          mission_id?: string
          notes?: string | null
          organization_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          scheduled_at?: string
          scheduled_for?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          signed_by?: string | null
          skipped_at?: string | null
          skipped_by?: string | null
          skipped_reason?: string | null
          slot?: string | null
          status?: Database["public"]["Enums"]["intervention_status"]
          team?: string[]
          template_id?: string | null
          tsv?: unknown
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interventions_assigned_team_id_fkey"
            columns: ["assigned_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_skipped_by_fkey"
            columns: ["skipped_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interventions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "intervention_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string | null
          embedding: string | null
          id: string
          metadata: Json | null
          organization_id: string | null
          source_domain: string
          source_id: string
          source_type: string
          tenant_id: string
        }
        Insert: {
          chunk_index?: number
          chunk_text: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          source_domain: string
          source_id: string
          source_type: string
          tenant_id: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          source_domain?: string
          source_id?: string
          source_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_items: {
        Row: {
          category: Database["public"]["Enums"]["knowledge_category"]
          content_markdown: string
          created_at: string | null
          deleted_at: string | null
          file_path: string | null
          id: string
          organization_id: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["knowledge_category"]
          content_markdown: string
          created_at?: string | null
          deleted_at?: string | null
          file_path?: string | null
          id?: string
          organization_id?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["knowledge_category"]
          content_markdown?: string
          created_at?: string | null
          deleted_at?: string | null
          file_path?: string | null
          id?: string
          organization_id?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_correction_events: {
        Row: {
          actor_id: string | null
          after_val: string | null
          ai_confidence: number | null
          before_val: string | null
          category: string
          cr_number: number | null
          created_at: string
          entity: string
          field: string | null
          id: string
          op: string
          report_id: string | null
          site_id: string | null
          source_type: string | null
          time_to_correct_ms: number | null
        }
        Insert: {
          actor_id?: string | null
          after_val?: string | null
          ai_confidence?: number | null
          before_val?: string | null
          category: string
          cr_number?: number | null
          created_at?: string
          entity: string
          field?: string | null
          id?: string
          op: string
          report_id?: string | null
          site_id?: string | null
          source_type?: string | null
          time_to_correct_ms?: number | null
        }
        Update: {
          actor_id?: string | null
          after_val?: string | null
          ai_confidence?: number | null
          before_val?: string | null
          category?: string
          cr_number?: number | null
          created_at?: string
          entity?: string
          field?: string | null
          id?: string
          op?: string
          report_id?: string | null
          site_id?: string | null
          source_type?: string | null
          time_to_correct_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "memory_correction_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_correction_events_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_correction_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_scopes: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          label: string
          organization_id: string
          parent_scope_id: string | null
          scope_type_key: string | null
          site_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          label: string
          organization_id: string
          parent_scope_id?: string | null
          scope_type_key?: string | null
          site_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          label?: string
          organization_id?: string
          parent_scope_id?: string | null
          scope_type_key?: string | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_scopes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_scopes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_scopes_parent_scope_id_fkey"
            columns: ["parent_scope_id"]
            isOneToOne: false
            referencedRelation: "memory_scopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_scopes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      missions: {
        Row: {
          active: boolean
          assigned_team_id: string | null
          cadence: Database["public"]["Enums"]["mission_cadence"]
          created_at: string | null
          created_by: string | null
          default_checklist: Json
          default_team: string[]
          deleted_at: string | null
          description: string | null
          engagement_ids: string[]
          id: string
          name: string
          organization_id: string | null
          site_id: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean
          assigned_team_id?: string | null
          cadence?: Database["public"]["Enums"]["mission_cadence"]
          created_at?: string | null
          created_by?: string | null
          default_checklist?: Json
          default_team?: string[]
          deleted_at?: string | null
          description?: string | null
          engagement_ids?: string[]
          id?: string
          name: string
          organization_id?: string | null
          site_id: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean
          assigned_team_id?: string | null
          cadence?: Database["public"]["Enums"]["mission_cadence"]
          created_at?: string | null
          created_by?: string | null
          default_checklist?: Json
          default_team?: string[]
          deleted_at?: string | null
          description?: string | null
          engagement_ids?: string[]
          id?: string
          name?: string
          organization_id?: string | null
          site_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "missions_assigned_team_id_fkey"
            columns: ["assigned_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      obligation_template: {
        Row: {
          closure: string
          code: string
          created_at: string
          default_responsible_role: string
          id: string
          importance: string
          is_active: boolean
          label: string
          organization_id: string | null
          phase_key: string | null
          sort_order: number
          themes: string[]
          trigger: string
          verification_kind: string
          verification_param: Json
        }
        Insert: {
          closure?: string
          code: string
          created_at?: string
          default_responsible_role?: string
          id?: string
          importance?: string
          is_active?: boolean
          label: string
          organization_id?: string | null
          phase_key?: string | null
          sort_order?: number
          themes?: string[]
          trigger?: string
          verification_kind?: string
          verification_param?: Json
        }
        Update: {
          closure?: string
          code?: string
          created_at?: string
          default_responsible_role?: string
          id?: string
          importance?: string
          is_active?: boolean
          label?: string
          organization_id?: string | null
          phase_key?: string | null
          sort_order?: number
          themes?: string[]
          trigger?: string
          verification_kind?: string
          verification_param?: Json
        }
        Relationships: []
      }
      org_catalog: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          key: string
          kind: string
          label: string
          metadata: Json
          organization_id: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          key: string
          kind: string
          label: string
          metadata?: Json
          organization_id: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          key?: string
          kind?: string
          label?: string
          metadata?: Json
          organization_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_catalog_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          color: string | null
          created_at: string
          demo_seed_key: string | null
          id: string
          industry_template: string
          is_demo: boolean
          logo_path: string | null
          logo_updated_at: string | null
          logo_url: string | null
          name: string
          slug: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          demo_seed_key?: string | null
          id?: string
          industry_template?: string
          is_demo?: boolean
          logo_path?: string | null
          logo_updated_at?: string | null
          logo_url?: string | null
          name: string
          slug?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          demo_seed_key?: string | null
          id?: string
          industry_template?: string
          is_demo?: boolean
          logo_path?: string | null
          logo_updated_at?: string | null
          logo_url?: string | null
          name?: string
          slug?: string | null
        }
        Relationships: []
      }
      planning_cycle_slots: {
        Row: {
          created_at: string
          cycle_id: string
          end_time: string | null
          id: string
          start_time: string | null
          state: string
          team_id: string
          week_index: number
          weekday: number
        }
        Insert: {
          created_at?: string
          cycle_id: string
          end_time?: string | null
          id?: string
          start_time?: string | null
          state?: string
          team_id: string
          week_index: number
          weekday: number
        }
        Update: {
          created_at?: string
          cycle_id?: string
          end_time?: string | null
          id?: string
          start_time?: string | null
          state?: string
          team_id?: string
          week_index?: number
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "planning_cycle_slots_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "planning_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_cycle_slots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_cycles: {
        Row: {
          anchor_date: string
          created_at: string
          created_by: string | null
          cycle_length_weeks: number
          deleted_at: string | null
          ends_on: string | null
          id: string
          mission_id: string
          name: string
          organization_id: string | null
          site_id: string
          starts_on: string
          status: string
          supersedes_cycle_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          anchor_date: string
          created_at?: string
          created_by?: string | null
          cycle_length_weeks: number
          deleted_at?: string | null
          ends_on?: string | null
          id?: string
          mission_id: string
          name: string
          organization_id?: string | null
          site_id: string
          starts_on: string
          status?: string
          supersedes_cycle_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          anchor_date?: string
          created_at?: string
          created_by?: string | null
          cycle_length_weeks?: number
          deleted_at?: string | null
          ends_on?: string | null
          id?: string
          mission_id?: string
          name?: string
          organization_id?: string | null
          site_id?: string
          starts_on?: string
          status?: string
          supersedes_cycle_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planning_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_cycles_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_cycles_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_cycles_supersedes_cycle_id_fkey"
            columns: ["supersedes_cycle_id"]
            isOneToOne: false
            referencedRelation: "planning_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_cycles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_share_tokens: {
        Row: {
          access_count: number
          closed_at: string | null
          closed_by: string | null
          closure_note: string | null
          contract_id: string | null
          created_at: string
          created_by: string | null
          dg_note: string | null
          expires_at: string
          frozen_at: string | null
          frozen_pdf_path: string | null
          frozen_pdf_sha256: string | null
          id: string
          include_identities: boolean
          intervention_id: string | null
          last_accessed_at: string | null
          organization_id: string | null
          presentation_kind: string
          report_month: string | null
          revoked_at: string | null
          selected_photo_ids: string[] | null
          token: string
        }
        Insert: {
          access_count?: number
          closed_at?: string | null
          closed_by?: string | null
          closure_note?: string | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          dg_note?: string | null
          expires_at: string
          frozen_at?: string | null
          frozen_pdf_path?: string | null
          frozen_pdf_sha256?: string | null
          id?: string
          include_identities?: boolean
          intervention_id?: string | null
          last_accessed_at?: string | null
          organization_id?: string | null
          presentation_kind?: string
          report_month?: string | null
          revoked_at?: string | null
          selected_photo_ids?: string[] | null
          token: string
        }
        Update: {
          access_count?: number
          closed_at?: string | null
          closed_by?: string | null
          closure_note?: string | null
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          dg_note?: string | null
          expires_at?: string
          frozen_at?: string | null
          frozen_pdf_path?: string | null
          frozen_pdf_sha256?: string | null
          id?: string
          include_identities?: boolean
          intervention_id?: string | null
          last_accessed_at?: string | null
          organization_id?: string | null
          presentation_kind?: string
          report_month?: string | null
          revoked_at?: string | null
          selected_photo_ids?: string[] | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_share_tokens_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_share_tokens_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_share_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_share_tokens_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_share_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_verification_tokens: {
        Row: {
          contract_id: string | null
          created_at: string
          created_by: string | null
          id: string
          intervention_id: string | null
          report_month: string | null
          tenant_name: string | null
          token: string
        }
        Insert: {
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          intervention_id?: string | null
          report_month?: string | null
          tenant_name?: string | null
          token: string
        }
        Update: {
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          intervention_id?: string | null
          report_month?: string | null
          tenant_name?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_verification_tokens_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_verification_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_verification_tokens_intervention_id_fkey"
            columns: ["intervention_id"]
            isOneToOne: false
            referencedRelation: "interventions"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_signal_decisions: {
        Row: {
          comment: string | null
          decided_at: string
          decided_by: string | null
          id: string
          report_id: string
          signal_id: string
          statut: string
        }
        Insert: {
          comment?: string | null
          decided_at?: string
          decided_by?: string | null
          id?: string
          report_id: string
          signal_id: string
          statut: string
        }
        Update: {
          comment?: string | null
          decided_at?: string
          decided_by?: string | null
          id?: string
          report_id?: string
          signal_id?: string
          statut?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_signal_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_signal_decisions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_access_log: {
        Row: {
          id: string
          scanned_at: string
          token_id: string
          user_agent: string | null
        }
        Insert: {
          id?: string
          scanned_at?: string
          token_id: string
          user_agent?: string | null
        }
        Update: {
          id?: string
          scanned_at?: string
          token_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_access_log_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "site_access_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      report_added_points: {
        Row: {
          assigned_to: string | null
          confiance: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          kind: string
          label: string
          report_id: string
          statut: string | null
          subject_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          confiance?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          kind: string
          label: string
          report_id: string
          statut?: string | null
          subject_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          confiance?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          kind?: string
          label?: string
          report_id?: string
          statut?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_added_points_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_added_points_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_added_points_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      report_analysis_runs: {
        Row: {
          created_at: string
          delta: Json | null
          id: string
          report_id: string
          source_count: number | null
          trigger: string
        }
        Insert: {
          created_at?: string
          delta?: Json | null
          id?: string
          report_id: string
          source_count?: number | null
          trigger?: string
        }
        Update: {
          created_at?: string
          delta?: Json | null
          id?: string
          report_id?: string
          source_count?: number | null
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_analysis_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_cr_meta: {
        Row: {
          photos_comment: string | null
          report_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          photos_comment?: string | null
          report_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          photos_comment?: string | null
          report_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_cr_meta_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_cr_meta_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      report_documents: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string | null
          final_document_id: string | null
          final_path: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          model: string | null
          organization_id: string
          pdf_path: string | null
          prompt_version: string | null
          provider: string | null
          reopened_at: string | null
          reopened_by: string | null
          report_id: string
          sections: Json
          site_id: string | null
          status: string
          template_key: string
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          final_document_id?: string | null
          final_path?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          model?: string | null
          organization_id: string
          pdf_path?: string | null
          prompt_version?: string | null
          provider?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          report_id: string
          sections?: Json
          site_id?: string | null
          status?: string
          template_key: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          final_document_id?: string | null
          final_path?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          model?: string | null
          organization_id?: string
          pdf_path?: string | null
          prompt_version?: string | null
          provider?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          report_id?: string
          sections?: Json
          site_id?: string | null
          status?: string
          template_key?: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_documents_final_document_id_fkey"
            columns: ["final_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_documents_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_documents_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_documents_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_documents_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_documents_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      report_final_versions: {
        Row: {
          document_id: string | null
          finalized_at: string
          finalized_by: string | null
          format: string
          id: string
          note: string | null
          path: string
          report_id: string
          version_no: number
        }
        Insert: {
          document_id?: string | null
          finalized_at?: string
          finalized_by?: string | null
          format: string
          id?: string
          note?: string | null
          path: string
          report_id: string
          version_no: number
        }
        Update: {
          document_id?: string | null
          finalized_at?: string
          finalized_by?: string | null
          format?: string
          id?: string
          note?: string | null
          path?: string
          report_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_final_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_final_versions_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_final_versions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_human_points: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          report_id: string
          section: string
          sort_order: number
          text: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          report_id: string
          section: string
          sort_order?: number
          text: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          report_id?: string
          section?: string
          sort_order?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_human_points_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_human_points_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_photo_meta: {
        Row: {
          id: string
          is_cover: boolean
          photo_id: string
          report_id: string
          sort_order: number
          source: string
          updated_at: string
        }
        Insert: {
          id?: string
          is_cover?: boolean
          photo_id: string
          report_id: string
          sort_order?: number
          source: string
          updated_at?: string
        }
        Update: {
          id?: string
          is_cover?: boolean
          photo_id?: string
          report_id?: string
          sort_order?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_photo_meta_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_photos: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          report_id: string
          storage_path: string
          taken_at: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          report_id: string
          storage_path: string
          taken_at?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          report_id?: string
          storage_path?: string
          taken_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_photos_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_point_actions: {
        Row: {
          codes: string[]
          id: string
          organisations: string[]
          point_source: string
          report_id: string
          updated_at: string
        }
        Insert: {
          codes?: string[]
          id?: string
          organisations?: string[]
          point_source: string
          report_id: string
          updated_at?: string
        }
        Update: {
          codes?: string[]
          id?: string
          organisations?: string[]
          point_source?: string
          report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_point_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_sites: {
        Row: {
          created_at: string
          report_id: string
          site_id: string
        }
        Insert: {
          created_at?: string
          report_id: string
          site_id: string
        }
        Update: {
          created_at?: string
          report_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_sites_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_sites_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string | null
          id: string
          mission_id: string
          notes: string | null
          organization_id: string | null
          pdf_storage_path: string | null
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          mission_id: string
          notes?: string | null
          organization_id?: string | null
          pdf_storage_path?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          mission_id?: string
          notes?: string | null
          organization_id?: string | null
          pdf_storage_path?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      school_calendar_period: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          ends_on: string
          id: string
          kind: string
          label: string
          organization_id: string | null
          starts_on: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          ends_on: string
          id?: string
          kind?: string
          label: string
          organization_id?: string | null
          starts_on: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          ends_on?: string
          id?: string
          kind?: string
          label?: string
          organization_id?: string | null
          starts_on?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_calendar_period_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_calendar_period_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_calendar_period_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      share_access_log: {
        Row: {
          accessed_at: string
          id: string
          ip_address: unknown
          kind: string
          token_id: string
          user_agent: string | null
        }
        Insert: {
          accessed_at?: string
          id?: string
          ip_address?: unknown
          kind: string
          token_id: string
          user_agent?: string | null
        }
        Update: {
          accessed_at?: string
          id?: string
          ip_address?: unknown
          kind?: string
          token_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "share_access_log_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "proof_share_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      share_token_comments: {
        Row: {
          comment: string
          created_at: string
          id: string
          ip_hash: string | null
          photo_paths: string[] | null
          token_id: string
          visitor_label: string | null
        }
        Insert: {
          comment: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          photo_paths?: string[] | null
          token_id: string
          visitor_label?: string | null
        }
        Update: {
          comment?: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          photo_paths?: string[] | null
          token_id?: string
          visitor_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "share_token_comments_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "proof_share_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      site_access_tokens: {
        Row: {
          access_count: number
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          last_accessed_at: string | null
          purpose: string
          revoked_at: string | null
          site_id: string
          token: string
        }
        Insert: {
          access_count?: number
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          purpose?: string
          revoked_at?: string | null
          site_id: string
          token: string
        }
        Update: {
          access_count?: number
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          purpose?: string
          revoked_at?: string | null
          site_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_access_tokens_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_action_events: {
        Row: {
          action_id: string
          actor_id: string | null
          actor_label: string | null
          after_value: Json | null
          before_value: Json | null
          created_at: string
          id: string
          kind: string
          occurred_at: string
          organization_id: string
          reason: string | null
          site_id: string
        }
        Insert: {
          action_id: string
          actor_id?: string | null
          actor_label?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          kind: string
          occurred_at?: string
          organization_id: string
          reason?: string | null
          site_id: string
        }
        Update: {
          action_id?: string
          actor_id?: string | null
          actor_label?: string | null
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          id?: string
          kind?: string
          occurred_at?: string
          organization_id?: string
          reason?: string | null
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_action_events_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "site_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_action_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_action_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_action_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_action_events_site_org_fk"
            columns: ["site_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      site_actions: {
        Row: {
          assigned_company_id: string | null
          assigned_contact_id: string | null
          assigned_to: string | null
          body: string | null
          completed_comment: string | null
          completed_photo_path: string | null
          converted_to_id: string | null
          converted_to_type: string | null
          corps_etat: string | null
          created_at: string
          created_by: string | null
          created_from: string | null
          done_at: string | null
          due_date: string | null
          due_date_status: string | null
          ext_at: string | null
          ext_by: string | null
          ext_comment: string | null
          ext_photo_path: string | null
          ext_status: string | null
          id: string
          kind: string
          last_progress_at: string | null
          organization_id: string
          report_id: string | null
          reserve_id: string | null
          scope_id: string | null
          site_id: string
          snooze_reason: string | null
          snoozed_at: string | null
          source_capture_id: string | null
          status: string
          subject_id: string | null
          title: string
          tsv: unknown
        }
        Insert: {
          assigned_company_id?: string | null
          assigned_contact_id?: string | null
          assigned_to?: string | null
          body?: string | null
          completed_comment?: string | null
          completed_photo_path?: string | null
          converted_to_id?: string | null
          converted_to_type?: string | null
          corps_etat?: string | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          done_at?: string | null
          due_date?: string | null
          due_date_status?: string | null
          ext_at?: string | null
          ext_by?: string | null
          ext_comment?: string | null
          ext_photo_path?: string | null
          ext_status?: string | null
          id?: string
          kind?: string
          last_progress_at?: string | null
          organization_id: string
          report_id?: string | null
          reserve_id?: string | null
          scope_id?: string | null
          site_id: string
          snooze_reason?: string | null
          snoozed_at?: string | null
          source_capture_id?: string | null
          status?: string
          subject_id?: string | null
          title: string
          tsv?: unknown
        }
        Update: {
          assigned_company_id?: string | null
          assigned_contact_id?: string | null
          assigned_to?: string | null
          body?: string | null
          completed_comment?: string | null
          completed_photo_path?: string | null
          converted_to_id?: string | null
          converted_to_type?: string | null
          corps_etat?: string | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          done_at?: string | null
          due_date?: string | null
          due_date_status?: string | null
          ext_at?: string | null
          ext_by?: string | null
          ext_comment?: string | null
          ext_photo_path?: string | null
          ext_status?: string | null
          id?: string
          kind?: string
          last_progress_at?: string | null
          organization_id?: string
          report_id?: string | null
          reserve_id?: string | null
          scope_id?: string | null
          site_id?: string
          snooze_reason?: string | null
          snoozed_at?: string | null
          source_capture_id?: string | null
          status?: string
          subject_id?: string | null
          title?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "site_actions_assigned_company_id_fkey"
            columns: ["assigned_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_actions_assigned_contact_id_fkey"
            columns: ["assigned_contact_id"]
            isOneToOne: false
            referencedRelation: "company_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_actions_reserve_id_fkey"
            columns: ["reserve_id"]
            isOneToOne: false
            referencedRelation: "site_reserve"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_actions_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "memory_scopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_actions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_actions_site_org_fk"
            columns: ["site_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "site_actions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_blocages: {
        Row: {
          created_at: string
          created_by: string | null
          date_end: string | null
          date_start: string
          day_log_id: string | null
          description: string | null
          id: string
          impact: string | null
          organization_id: string | null
          site_id: string
          source_report_id: string | null
          source_type: string
          subject_id: string | null
          title: string
          tsv: unknown
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date_end?: string | null
          date_start?: string
          day_log_id?: string | null
          description?: string | null
          id?: string
          impact?: string | null
          organization_id?: string | null
          site_id: string
          source_report_id?: string | null
          source_type?: string
          subject_id?: string | null
          title: string
          tsv?: unknown
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date_end?: string | null
          date_start?: string
          day_log_id?: string | null
          description?: string | null
          id?: string
          impact?: string | null
          organization_id?: string | null
          site_id?: string
          source_report_id?: string | null
          source_type?: string
          subject_id?: string | null
          title?: string
          tsv?: unknown
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_blocages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_blocages_day_log_id_fkey"
            columns: ["day_log_id"]
            isOneToOne: false
            referencedRelation: "site_day_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_blocages_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_blocages_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_blocages_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_closures: {
        Row: {
          calendar_period_id: string | null
          created_at: string
          created_by: string | null
          default_resolution: string
          deleted_at: string | null
          ends_on: string
          id: string
          reason: string | null
          reason_kind: string
          site_id: string
          starts_on: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          calendar_period_id?: string | null
          created_at?: string
          created_by?: string | null
          default_resolution?: string
          deleted_at?: string | null
          ends_on: string
          id?: string
          reason?: string | null
          reason_kind?: string
          site_id: string
          starts_on: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          calendar_period_id?: string | null
          created_at?: string
          created_by?: string | null
          default_resolution?: string
          deleted_at?: string | null
          ends_on?: string
          id?: string
          reason?: string | null
          reason_kind?: string
          site_id?: string
          starts_on?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_closures_calendar_period_id_fkey"
            columns: ["calendar_period_id"]
            isOneToOne: false
            referencedRelation: "school_calendar_period"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_closures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_closures_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_closures_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      site_day_log: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          intemperie: boolean
          log_date: string
          note: string | null
          organization_id: string | null
          precipitation_mm: number | null
          site_id: string
          temp_max: number | null
          temp_min: number | null
          updated_at: string
          weather: string | null
          weather_fetched_at: string | null
          weather_source: string | null
          wind_max_kmh: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          intemperie?: boolean
          log_date: string
          note?: string | null
          organization_id?: string | null
          precipitation_mm?: number | null
          site_id: string
          temp_max?: number | null
          temp_min?: number | null
          updated_at?: string
          weather?: string | null
          weather_fetched_at?: string | null
          weather_source?: string | null
          wind_max_kmh?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          intemperie?: boolean
          log_date?: string
          note?: string | null
          organization_id?: string | null
          precipitation_mm?: number | null
          site_id?: string
          temp_max?: number | null
          temp_min?: number | null
          updated_at?: string
          weather?: string | null
          weather_fetched_at?: string | null
          weather_source?: string | null
          wind_max_kmh?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "site_day_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_day_log_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_deadlines: {
        Row: {
          cancel_comment: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          constraint_text: string | null
          created_at: string
          created_by: string | null
          created_from: string | null
          deleted_at: string | null
          due_date: string | null
          id: string
          organization_id: string | null
          report_id: string | null
          site_id: string
          status: string
          superseded_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          cancel_comment?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          constraint_text?: string | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          deleted_at?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string | null
          report_id?: string | null
          site_id: string
          status?: string
          superseded_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          cancel_comment?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          constraint_text?: string | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          deleted_at?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string | null
          report_id?: string | null
          site_id?: string
          status?: string
          superseded_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_deadlines_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_deadlines_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_deadlines_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_deadlines_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_deadlines_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "site_deadlines"
            referencedColumns: ["id"]
          },
        ]
      }
      site_decisions: {
        Row: {
          action_id: string | null
          confiance: string
          created_at: string
          created_by: string | null
          date_decision: string
          decisionnaire_contact_id: string | null
          decisionnaire_org: string | null
          decisionnaire_role: string | null
          description: string | null
          echeance: string | null
          id: string
          impact: string | null
          organization_id: string
          report_id: string | null
          site_id: string
          source: string
          statut: string
          subject_id: string | null
          sujet: string | null
          titre: string
          tsv: unknown
          updated_at: string
        }
        Insert: {
          action_id?: string | null
          confiance?: string
          created_at?: string
          created_by?: string | null
          date_decision?: string
          decisionnaire_contact_id?: string | null
          decisionnaire_org?: string | null
          decisionnaire_role?: string | null
          description?: string | null
          echeance?: string | null
          id?: string
          impact?: string | null
          organization_id: string
          report_id?: string | null
          site_id: string
          source?: string
          statut?: string
          subject_id?: string | null
          sujet?: string | null
          titre: string
          tsv?: unknown
          updated_at?: string
        }
        Update: {
          action_id?: string | null
          confiance?: string
          created_at?: string
          created_by?: string | null
          date_decision?: string
          decisionnaire_contact_id?: string | null
          decisionnaire_org?: string | null
          decisionnaire_role?: string | null
          description?: string | null
          echeance?: string | null
          id?: string
          impact?: string | null
          organization_id?: string
          report_id?: string | null
          site_id?: string
          source?: string
          statut?: string
          subject_id?: string | null
          sujet?: string | null
          titre?: string
          tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_decisions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "site_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_decisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_decisions_decisionnaire_contact_id_fkey"
            columns: ["decisionnaire_contact_id"]
            isOneToOne: false
            referencedRelation: "company_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_decisions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_decisions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_decisions_site_org_fk"
            columns: ["site_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "site_decisions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_delivery: {
        Row: {
          created_at: string
          created_by: string | null
          delivered_on: string
          id: string
          material: string | null
          note: string | null
          organization_id: string | null
          photo_path: string | null
          quantity: string | null
          reference: string | null
          site_id: string
          supplier: string | null
          updated_at: string
          zone: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivered_on: string
          id?: string
          material?: string | null
          note?: string | null
          organization_id?: string | null
          photo_path?: string | null
          quantity?: string | null
          reference?: string | null
          site_id: string
          supplier?: string | null
          updated_at?: string
          zone?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivered_on?: string
          id?: string
          material?: string | null
          note?: string | null
          organization_id?: string | null
          photo_path?: string | null
          quantity?: string | null
          reference?: string | null
          site_id?: string
          supplier?: string | null
          updated_at?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_delivery_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_delivery_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_intervenants: {
        Row: {
          company_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          main_contact_id: string | null
          organization_id: string
          role: string
          site_id: string
          source_report_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          main_contact_id?: string | null
          organization_id: string
          role: string
          site_id: string
          source_report_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          main_contact_id?: string | null
          organization_id?: string
          role?: string
          site_id?: string
          source_report_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_intervenants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_intervenants_main_contact_id_fkey"
            columns: ["main_contact_id"]
            isOneToOne: false
            referencedRelation: "company_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_intervenants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_intervenants_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_intervenants_site_org_fk"
            columns: ["site_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "site_intervenants_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      site_knowledge_entities: {
        Row: {
          canonical_label: string
          confidence: number
          created_at: string
          created_by: string | null
          entity_type: string
          id: string
          is_active: boolean
          metadata: Json
          organization_id: string
          site_id: string | null
          source: string
          updated_at: string
          user_id: string | null
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          canonical_label: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          entity_type: string
          id?: string
          is_active?: boolean
          metadata?: Json
          organization_id: string
          site_id?: string | null
          source?: string
          updated_at?: string
          user_id?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          canonical_label?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          entity_type?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          organization_id?: string
          site_id?: string | null
          source?: string
          updated_at?: string
          user_id?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_knowledge_entities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entities_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entities_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      site_knowledge_entity_aliases: {
        Row: {
          alias: string
          alias_norm: string
          created_at: string
          entity_id: string
          id: string
          organization_id: string
          site_id: string | null
          user_id: string | null
        }
        Insert: {
          alias: string
          alias_norm: string
          created_at?: string
          entity_id: string
          id?: string
          organization_id: string
          site_id?: string | null
          user_id?: string | null
        }
        Update: {
          alias?: string
          alias_norm?: string
          created_at?: string
          entity_id?: string
          id?: string
          organization_id?: string
          site_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_knowledge_entity_aliases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "site_knowledge_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entity_aliases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entity_aliases_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entity_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      site_knowledge_entries: {
        Row: {
          body: string | null
          confirmed_at: string
          confirmed_by: string | null
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          organization_id: string
          site_id: string
          source_capture_ids: string[]
          source_report_id: string | null
          status: string
          supersedes_id: string | null
          thematic_category: string | null
          title: string
          updated_at: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          body?: string | null
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: string
          organization_id: string
          site_id: string
          source_capture_ids?: string[]
          source_report_id?: string | null
          status?: string
          supersedes_id?: string | null
          thematic_category?: string | null
          title: string
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          body?: string | null
          confirmed_at?: string
          confirmed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          organization_id?: string
          site_id?: string
          source_capture_ids?: string[]
          source_report_id?: string | null
          status?: string
          supersedes_id?: string | null
          thematic_category?: string | null
          title?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_knowledge_entries_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entries_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_entries_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "site_knowledge_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      site_knowledge_proposals: {
        Row: {
          analysis_version: number
          body: string | null
          confidence: string | null
          created_at: string
          dedupe_key: string
          dismiss_reason: string | null
          id: string
          kind: string
          organization_id: string
          payload: Json
          promoted_object_id: string | null
          promoted_object_type: string | null
          report_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          site_id: string
          source_capture_ids: string[]
          status: string
          superseded_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          analysis_version?: number
          body?: string | null
          confidence?: string | null
          created_at?: string
          dedupe_key: string
          dismiss_reason?: string | null
          id?: string
          kind: string
          organization_id: string
          payload?: Json
          promoted_object_id?: string | null
          promoted_object_type?: string | null
          report_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          site_id: string
          source_capture_ids?: string[]
          status?: string
          superseded_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          analysis_version?: number
          body?: string | null
          confidence?: string | null
          created_at?: string
          dedupe_key?: string
          dismiss_reason?: string | null
          id?: string
          kind?: string
          organization_id?: string
          payload?: Json
          promoted_object_id?: string | null
          promoted_object_type?: string | null
          report_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          site_id?: string
          source_capture_ids?: string[]
          status?: string
          superseded_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_knowledge_proposals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_proposals_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_proposals_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_knowledge_proposals_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "site_knowledge_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      site_morning_digest: {
        Row: {
          computed_at: string
          digest_date: string
          duration_ms: number | null
          id: string
          organization_id: string | null
          signal_count: number
          signals: Json
          site_id: string
        }
        Insert: {
          computed_at?: string
          digest_date: string
          duration_ms?: number | null
          id?: string
          organization_id?: string | null
          signal_count?: number
          signals?: Json
          site_id: string
        }
        Update: {
          computed_at?: string
          digest_date?: string
          duration_ms?: number | null
          id?: string
          organization_id?: string | null
          signal_count?: number
          signals?: Json
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_morning_digest_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_notes: {
        Row: {
          active_until: string | null
          body: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          kind: string
          organization_id: string | null
          site_id: string
          tsv: unknown
        }
        Insert: {
          active_until?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          organization_id?: string | null
          site_id: string
          tsv?: unknown
        }
        Update: {
          active_until?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          organization_id?: string | null
          site_id?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "site_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_notes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_obligation: {
        Row: {
          closure: string
          created_at: string
          created_by: string | null
          id: string
          importance: string
          label: string
          last_reminded_at: string | null
          organization_id: string | null
          origin_date: string | null
          origin_engagement_id: string | null
          origin_excerpt: string | null
          origin_page: number | null
          origin_ref: string | null
          origin_section: string | null
          origin_tender_id: string | null
          phase_key: string | null
          responsible_contact_id: string | null
          responsible_role: string
          satisfied_at: string | null
          satisfied_note: string | null
          site_id: string
          status: string
          subject_id: string | null
          template_id: string | null
          trigger: string
          tsv: unknown
          updated_at: string
          verification_kind: string
          verification_param: Json
        }
        Insert: {
          closure?: string
          created_at?: string
          created_by?: string | null
          id?: string
          importance?: string
          label: string
          last_reminded_at?: string | null
          organization_id?: string | null
          origin_date?: string | null
          origin_engagement_id?: string | null
          origin_excerpt?: string | null
          origin_page?: number | null
          origin_ref?: string | null
          origin_section?: string | null
          origin_tender_id?: string | null
          phase_key?: string | null
          responsible_contact_id?: string | null
          responsible_role?: string
          satisfied_at?: string | null
          satisfied_note?: string | null
          site_id: string
          status?: string
          subject_id?: string | null
          template_id?: string | null
          trigger?: string
          tsv?: unknown
          updated_at?: string
          verification_kind?: string
          verification_param?: Json
        }
        Update: {
          closure?: string
          created_at?: string
          created_by?: string | null
          id?: string
          importance?: string
          label?: string
          last_reminded_at?: string | null
          organization_id?: string | null
          origin_date?: string | null
          origin_engagement_id?: string | null
          origin_excerpt?: string | null
          origin_page?: number | null
          origin_ref?: string | null
          origin_section?: string | null
          origin_tender_id?: string | null
          phase_key?: string | null
          responsible_contact_id?: string | null
          responsible_role?: string
          satisfied_at?: string | null
          satisfied_note?: string | null
          site_id?: string
          status?: string
          subject_id?: string | null
          template_id?: string | null
          trigger?: string
          tsv?: unknown
          updated_at?: string
          verification_kind?: string
          verification_param?: Json
        }
        Relationships: [
          {
            foreignKeyName: "site_obligation_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_obligation_origin_engagement_id_fkey"
            columns: ["origin_engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_obligation_origin_tender_id_fkey"
            columns: ["origin_tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_obligation_responsible_contact_id_fkey"
            columns: ["responsible_contact_id"]
            isOneToOne: false
            referencedRelation: "company_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_obligation_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_obligation_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_obligation_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "obligation_template"
            referencedColumns: ["id"]
          },
        ]
      }
      site_reading_candidates: {
        Row: {
          algorithm_version: string
          expires_at: string | null
          fragment: string
          generated_at: string
          id: string
          internal_score: number | null
          organization_id: string | null
          reading_type: string
          site_id: string
          source_ids: Json
          status: string
          tenant_id: string
        }
        Insert: {
          algorithm_version?: string
          expires_at?: string | null
          fragment: string
          generated_at?: string
          id?: string
          internal_score?: number | null
          organization_id?: string | null
          reading_type: string
          site_id: string
          source_ids?: Json
          status?: string
          tenant_id: string
        }
        Update: {
          algorithm_version?: string
          expires_at?: string | null
          fragment?: string
          generated_at?: string
          id?: string
          internal_score?: number | null
          organization_id?: string | null
          reading_type?: string
          site_id?: string
          source_ids?: Json
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_reading_candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reading_candidates_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_report_attachments: {
        Row: {
          added_at: string | null
          added_by: string | null
          client_uuid: string | null
          created_at: string
          duration_seconds: number | null
          filename: string | null
          id: string
          kind: string
          label: string | null
          mime_type: string | null
          recorded_ended_at: string | null
          recorded_started_at: string | null
          report_id: string
          sha256: string | null
          size_bytes: number | null
          source_origin: string | null
          source_weight: number | null
          storage_path: string
          transcribed_at: string | null
          transcript_raw: string | null
          transcript_status: string
          type_source: string | null
          uploaded_after_meeting: boolean
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          client_uuid?: string | null
          created_at?: string
          duration_seconds?: number | null
          filename?: string | null
          id?: string
          kind: string
          label?: string | null
          mime_type?: string | null
          recorded_ended_at?: string | null
          recorded_started_at?: string | null
          report_id: string
          sha256?: string | null
          size_bytes?: number | null
          source_origin?: string | null
          source_weight?: number | null
          storage_path: string
          transcribed_at?: string | null
          transcript_raw?: string | null
          transcript_status?: string
          type_source?: string | null
          uploaded_after_meeting?: boolean
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          client_uuid?: string | null
          created_at?: string
          duration_seconds?: number | null
          filename?: string | null
          id?: string
          kind?: string
          label?: string | null
          mime_type?: string | null
          recorded_ended_at?: string | null
          recorded_started_at?: string | null
          report_id?: string
          sha256?: string | null
          size_bytes?: number | null
          source_origin?: string | null
          source_weight?: number | null
          storage_path?: string
          transcribed_at?: string | null
          transcript_raw?: string | null
          transcript_status?: string
          type_source?: string | null
          uploaded_after_meeting?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "site_report_attachments_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_report_attachments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      site_report_proposals: {
        Row: {
          ai_confidence: number | null
          assigned_to: string | null
          category: string | null
          corps_etat: string | null
          created_at: string
          created_entity_id: string | null
          created_entity_type: string | null
          id: string
          origin: string
          payload: Json
          rationale: string | null
          report_id: string
          short_label: string
          site_id: string | null
          status: string
          subject_id: string | null
          tsv: unknown
          type: string
        }
        Insert: {
          ai_confidence?: number | null
          assigned_to?: string | null
          category?: string | null
          corps_etat?: string | null
          created_at?: string
          created_entity_id?: string | null
          created_entity_type?: string | null
          id?: string
          origin?: string
          payload?: Json
          rationale?: string | null
          report_id: string
          short_label: string
          site_id?: string | null
          status?: string
          subject_id?: string | null
          tsv?: unknown
          type: string
        }
        Update: {
          ai_confidence?: number | null
          assigned_to?: string | null
          category?: string | null
          corps_etat?: string | null
          created_at?: string
          created_entity_id?: string | null
          created_entity_type?: string | null
          id?: string
          origin?: string
          payload?: Json
          rationale?: string | null
          report_id?: string
          short_label?: string
          site_id?: string | null
          status?: string
          subject_id?: string | null
          tsv?: unknown
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_report_proposals_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_report_proposals_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_report_proposals_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_reports: {
        Row: {
          analysis_error: string | null
          audio_duration_seconds: number | null
          audio_mime: string | null
          audio_path: string | null
          contract_id: string | null
          cr_map_snapshot_path: string | null
          created_at: string
          created_by: string | null
          debrief_analysis: Json | null
          debrief_generating_at: string | null
          debrief_projected_at: string | null
          debrief_projection_error: string | null
          deleted_at: string | null
          dossier_id: string | null
          ended_at: string | null
          estimated_duration_minutes: number | null
          extraction_run_id: string | null
          id: string
          next_meeting_at: string | null
          objective: string | null
          organization_id: string | null
          origin: string | null
          outcome: string | null
          participants: Json
          resolution: string | null
          risks: Json
          site_id: string | null
          source: string | null
          source_document_id: string | null
          started_at: string | null
          status: string
          target_subject_id: string | null
          tenant_id: string
          text_input: string | null
          title: string | null
          transcript_corrected: string | null
          transcript_raw: string | null
          transcript_status: string
          tsv: unknown
          type: string
          updated_at: string
          visit_motive: string | null
        }
        Insert: {
          analysis_error?: string | null
          audio_duration_seconds?: number | null
          audio_mime?: string | null
          audio_path?: string | null
          contract_id?: string | null
          cr_map_snapshot_path?: string | null
          created_at?: string
          created_by?: string | null
          debrief_analysis?: Json | null
          debrief_generating_at?: string | null
          debrief_projected_at?: string | null
          debrief_projection_error?: string | null
          deleted_at?: string | null
          dossier_id?: string | null
          ended_at?: string | null
          estimated_duration_minutes?: number | null
          extraction_run_id?: string | null
          id?: string
          next_meeting_at?: string | null
          objective?: string | null
          organization_id?: string | null
          origin?: string | null
          outcome?: string | null
          participants?: Json
          resolution?: string | null
          risks?: Json
          site_id?: string | null
          source?: string | null
          source_document_id?: string | null
          started_at?: string | null
          status?: string
          target_subject_id?: string | null
          tenant_id: string
          text_input?: string | null
          title?: string | null
          transcript_corrected?: string | null
          transcript_raw?: string | null
          transcript_status?: string
          tsv?: unknown
          type?: string
          updated_at?: string
          visit_motive?: string | null
        }
        Update: {
          analysis_error?: string | null
          audio_duration_seconds?: number | null
          audio_mime?: string | null
          audio_path?: string | null
          contract_id?: string | null
          cr_map_snapshot_path?: string | null
          created_at?: string
          created_by?: string | null
          debrief_analysis?: Json | null
          debrief_generating_at?: string | null
          debrief_projected_at?: string | null
          debrief_projection_error?: string | null
          deleted_at?: string | null
          dossier_id?: string | null
          ended_at?: string | null
          estimated_duration_minutes?: number | null
          extraction_run_id?: string | null
          id?: string
          next_meeting_at?: string | null
          objective?: string | null
          organization_id?: string | null
          origin?: string | null
          outcome?: string | null
          participants?: Json
          resolution?: string | null
          risks?: Json
          site_id?: string | null
          source?: string | null
          source_document_id?: string | null
          started_at?: string | null
          status?: string
          target_subject_id?: string | null
          tenant_id?: string
          text_input?: string | null
          title?: string | null
          transcript_corrected?: string | null
          transcript_raw?: string | null
          transcript_status?: string
          tsv?: unknown
          type?: string
          updated_at?: string
          visit_motive?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_reports_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reports_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reports_extraction_run_id_fkey"
            columns: ["extraction_run_id"]
            isOneToOne: false
            referencedRelation: "document_extraction_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reports_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reports_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reports_target_subject_id_fkey"
            columns: ["target_subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_reserve: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          issued_by: string | null
          issued_on: string | null
          label: string
          lift_note: string | null
          lifted_at: string | null
          location: string | null
          organization_id: string | null
          photo_after_path: string | null
          photo_before_path: string | null
          site_id: string
          source_capture_id: string | null
          status: string
          subject_id: string | null
          tsv: unknown
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          issued_by?: string | null
          issued_on?: string | null
          label: string
          lift_note?: string | null
          lifted_at?: string | null
          location?: string | null
          organization_id?: string | null
          photo_after_path?: string | null
          photo_before_path?: string | null
          site_id: string
          source_capture_id?: string | null
          status?: string
          subject_id?: string | null
          tsv?: unknown
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          issued_by?: string | null
          issued_on?: string | null
          label?: string
          lift_note?: string | null
          lifted_at?: string | null
          location?: string | null
          organization_id?: string | null
          photo_after_path?: string | null
          photo_before_path?: string | null
          site_id?: string
          source_capture_id?: string | null
          status?: string
          subject_id?: string | null
          tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_reserve_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reserve_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_reserve_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_scheduled_events: {
        Row: {
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          created_from: string | null
          deleted_at: string | null
          id: string
          linked_report_id: string | null
          organization_id: string
          payload: Json
          planned_end: string | null
          planned_start: string
          site_id: string
          source_report_id: string | null
          status: string
          title: string | null
          type: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          deleted_at?: string | null
          id?: string
          linked_report_id?: string | null
          organization_id: string
          payload?: Json
          planned_end?: string | null
          planned_start: string
          site_id: string
          source_report_id?: string | null
          status?: string
          title?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          created_from?: string | null
          deleted_at?: string | null
          id?: string
          linked_report_id?: string | null
          organization_id?: string
          payload?: Json
          planned_end?: string | null
          planned_start?: string
          site_id?: string
          source_report_id?: string | null
          status?: string
          title?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_scheduled_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_scheduled_events_linked_report_id_fkey"
            columns: ["linked_report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_scheduled_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_scheduled_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_scheduled_events_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      site_watchpoints: {
        Row: {
          body: string | null
          confirmed_at: string
          confirmed_by: string | null
          converted_reserve_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          report_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          site_id: string
          source_capture_ids: string[]
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          confirmed_at?: string
          confirmed_by?: string | null
          converted_reserve_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          report_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          site_id: string
          source_capture_ids?: string[]
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          confirmed_at?: string
          confirmed_by?: string | null
          converted_reserve_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          report_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          site_id?: string
          source_capture_ids?: string[]
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_watchpoints_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_watchpoints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_watchpoints_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_watchpoints_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_watchpoints_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          access_code: string | null
          access_hours: string | null
          access_instructions: string | null
          address: string | null
          alarm_code: string | null
          canonical_site_key: string | null
          client_id: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_id: string | null
          cover_capture_id: string | null
          created_at: string | null
          deleted_at: string | null
          dns: string | null
          follows_public_holidays: boolean
          follows_school_calendar: boolean
          id: string
          is_sandbox: boolean
          latitude: number | null
          longitude: number | null
          name: string
          normalized_name: string | null
          notes: string | null
          organization_id: string
          phase: string
          public_holidays_effect: string
          qr_access_count: number
          qr_generated_at: string | null
          qr_last_accessed_at: string | null
          qr_token: string | null
          requires_access_handover: boolean
          school_calendar_effect: string
          tenant_id: string
        }
        Insert: {
          access_code?: string | null
          access_hours?: string | null
          access_instructions?: string | null
          address?: string | null
          alarm_code?: string | null
          canonical_site_key?: string | null
          client_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_id?: string | null
          cover_capture_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dns?: string | null
          follows_public_holidays?: boolean
          follows_school_calendar?: boolean
          id?: string
          is_sandbox?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          normalized_name?: string | null
          notes?: string | null
          organization_id: string
          phase?: string
          public_holidays_effect?: string
          qr_access_count?: number
          qr_generated_at?: string | null
          qr_last_accessed_at?: string | null
          qr_token?: string | null
          requires_access_handover?: boolean
          school_calendar_effect?: string
          tenant_id?: string
        }
        Update: {
          access_code?: string | null
          access_hours?: string | null
          access_instructions?: string | null
          address?: string | null
          alarm_code?: string | null
          canonical_site_key?: string | null
          client_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_id?: string | null
          cover_capture_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dns?: string | null
          follows_public_holidays?: boolean
          follows_school_calendar?: boolean
          id?: string
          is_sandbox?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          normalized_name?: string | null
          notes?: string | null
          organization_id?: string
          phase?: string
          public_holidays_effect?: string
          qr_access_count?: number
          qr_generated_at?: string | null
          qr_last_accessed_at?: string | null
          qr_token?: string | null
          requires_access_handover?: boolean
          school_calendar_effect?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_cover_capture_id_fkey"
            columns: ["cover_capture_id"]
            isOneToOne: false
            referencedRelation: "visit_capture"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_relation: {
        Row: {
          created_at: string
          created_by: string | null
          from_subject_id: string
          id: string
          importance: string
          organization_id: string | null
          reason: string
          to_subject_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_subject_id: string
          id?: string
          importance?: string
          organization_id?: string | null
          reason: string
          to_subject_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_subject_id?: string
          id?: string
          importance?: string
          organization_id?: string | null
          reason?: string
          to_subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_relation_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_relation_from_subject_id_fkey"
            columns: ["from_subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_relation_to_subject_id_fkey"
            columns: ["to_subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_thread_links: {
        Row: {
          confidence: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          evidence_proposal_id: string | null
          evidence_run_id: string | null
          from_thread_id: string
          id: string
          justification: string | null
          link_type: string
          site_id: string
          source: string
          status: string
          to_thread_id: string
        }
        Insert: {
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          evidence_proposal_id?: string | null
          evidence_run_id?: string | null
          from_thread_id: string
          id?: string
          justification?: string | null
          link_type: string
          site_id: string
          source: string
          status?: string
          to_thread_id: string
        }
        Update: {
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          evidence_proposal_id?: string | null
          evidence_run_id?: string | null
          from_thread_id?: string
          id?: string
          justification?: string | null
          link_type?: string
          site_id?: string
          source?: string
          status?: string
          to_thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_thread_links_evidence_proposal_id_fkey"
            columns: ["evidence_proposal_id"]
            isOneToOne: false
            referencedRelation: "document_extraction_proposal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_thread_links_evidence_run_id_fkey"
            columns: ["evidence_run_id"]
            isOneToOne: false
            referencedRelation: "document_extraction_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_thread_links_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          scope_id: string | null
          site_id: string
          status: string
          tsv: unknown
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          scope_id?: string | null
          site_id: string
          status?: string
          tsv?: unknown
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          scope_id?: string | null
          site_id?: string
          status?: string
          tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_scope_id_fkey"
            columns: ["scope_id"]
            isOneToOne: false
            referencedRelation: "memory_scopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subjects_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      team_field_members: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string | null
          id: string
          joined_at: string
          left_at: string | null
          organization_id: string
          team_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          joined_at?: string
          left_at?: string | null
          organization_id: string
          team_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          joined_at?: string
          left_at?: string | null
          organization_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_field_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "company_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_field_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_field_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_field_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          id: string
          joined_at: string
          left_at: string | null
          organization_id: string
          team_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          left_at?: string | null
          organization_id: string
          team_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          left_at?: string | null
          organization_id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_organization_fk"
            columns: ["team_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          icon: string | null
          id: string
          name: string
          organization_id: string | null
          referent_user_id: string | null
          specialties: string[]
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          icon?: string | null
          id?: string
          name: string
          organization_id?: string | null
          referent_user_id?: string | null
          specialties?: string[]
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          referent_user_id?: string | null
          specialties?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_referent_user_id_fkey"
            columns: ["referent_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_agent_analyses: {
        Row: {
          agent_name: string
          created_at: string | null
          error_msg: string | null
          id: string
          key_points: Json | null
          metadata: Json | null
          organization_id: string | null
          raw_content: string | null
          status: Database["public"]["Enums"]["agent_analysis_status"]
          summary: string | null
          tender_id: string
          updated_at: string | null
        }
        Insert: {
          agent_name: string
          created_at?: string | null
          error_msg?: string | null
          id?: string
          key_points?: Json | null
          metadata?: Json | null
          organization_id?: string | null
          raw_content?: string | null
          status?: Database["public"]["Enums"]["agent_analysis_status"]
          summary?: string | null
          tender_id: string
          updated_at?: string | null
        }
        Update: {
          agent_name?: string
          created_at?: string | null
          error_msg?: string | null
          id?: string
          key_points?: Json | null
          metadata?: Json | null
          organization_id?: string | null
          raw_content?: string | null
          status?: Database["public"]["Enums"]["agent_analysis_status"]
          summary?: string | null
          tender_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_agent_analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_agent_analyses_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_analyses: {
        Row: {
          checklist: Json | null
          constraints: Json | null
          created_at: string | null
          document_sources: Json | null
          id: string
          library_snapshot: Json | null
          model: string | null
          organization_id: string | null
          prompt_versions: Json | null
          provider: Database["public"]["Enums"]["ai_provider"]
          raw_response: Json | null
          risks: Json | null
          summary: string | null
          technical_memo: string | null
          tender_id: string
        }
        Insert: {
          checklist?: Json | null
          constraints?: Json | null
          created_at?: string | null
          document_sources?: Json | null
          id?: string
          library_snapshot?: Json | null
          model?: string | null
          organization_id?: string | null
          prompt_versions?: Json | null
          provider: Database["public"]["Enums"]["ai_provider"]
          raw_response?: Json | null
          risks?: Json | null
          summary?: string | null
          technical_memo?: string | null
          tender_id: string
        }
        Update: {
          checklist?: Json | null
          constraints?: Json | null
          created_at?: string | null
          document_sources?: Json | null
          id?: string
          library_snapshot?: Json | null
          model?: string | null
          organization_id?: string | null
          prompt_versions?: Json | null
          provider?: Database["public"]["Enums"]["ai_provider"]
          raw_response?: Json | null
          risks?: Json | null
          summary?: string | null
          technical_memo?: string | null
          tender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_analyses_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_chat_attachments: {
        Row: {
          created_at: string | null
          extracted_text: string | null
          filename: string
          id: string
          message_id: string
          organization_id: string | null
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          created_at?: string | null
          extracted_text?: string | null
          filename: string
          id?: string
          message_id: string
          organization_id?: string | null
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          created_at?: string | null
          extracted_text?: string | null
          filename?: string
          id?: string
          message_id?: string
          organization_id?: string | null
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_chat_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "tender_chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_chat_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_chat_messages: {
        Row: {
          agent_name: string | null
          content: string
          conversation_id: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          organization_id: string | null
          role: string
          tender_id: string
          user_id: string | null
        }
        Insert: {
          agent_name?: string | null
          content: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          role: string
          tender_id: string
          user_id?: string | null
        }
        Update: {
          agent_name?: string | null
          content?: string
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          role?: string
          tender_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "tender_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_chat_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_chat_messages_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_conversations: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string | null
          position: number
          tender_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          position?: number
          tender_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          position?: number
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_conversations_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_documents: {
        Row: {
          extracted_text: string | null
          extraction_source: string
          filename: string
          id: string
          kind: string | null
          organization_id: string | null
          page_count: number | null
          size_bytes: number | null
          storage_path: string
          tender_id: string
          uploaded_at: string | null
        }
        Insert: {
          extracted_text?: string | null
          extraction_source?: string
          filename: string
          id?: string
          kind?: string | null
          organization_id?: string | null
          page_count?: number | null
          size_bytes?: number | null
          storage_path: string
          tender_id: string
          uploaded_at?: string | null
        }
        Update: {
          extracted_text?: string | null
          extraction_source?: string
          filename?: string
          id?: string
          kind?: string | null
          organization_id?: string | null
          page_count?: number | null
          size_bytes?: number | null
          storage_path?: string
          tender_id?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_documents_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tenders: {
        Row: {
          client_name: string | null
          created_at: string | null
          created_by: string
          deadline: string | null
          deleted_at: string | null
          dossier_id: string | null
          error_msg: string | null
          id: string
          opportunity_score: number | null
          organization_id: string | null
          outcome: Database["public"]["Enums"]["tender_outcome"] | null
          outcome_at: string | null
          outcome_reason: string | null
          outcome_set_by: string | null
          outcome_tag: Database["public"]["Enums"]["tender_outcome_tag"] | null
          status: Database["public"]["Enums"]["tender_status"]
          title: string
          updated_at: string | null
          voice_note_duration_seconds: number | null
          voice_note_path: string | null
          voice_note_recorded_at: string | null
          voice_note_recorded_by: string | null
        }
        Insert: {
          client_name?: string | null
          created_at?: string | null
          created_by: string
          deadline?: string | null
          deleted_at?: string | null
          dossier_id?: string | null
          error_msg?: string | null
          id?: string
          opportunity_score?: number | null
          organization_id?: string | null
          outcome?: Database["public"]["Enums"]["tender_outcome"] | null
          outcome_at?: string | null
          outcome_reason?: string | null
          outcome_set_by?: string | null
          outcome_tag?: Database["public"]["Enums"]["tender_outcome_tag"] | null
          status?: Database["public"]["Enums"]["tender_status"]
          title: string
          updated_at?: string | null
          voice_note_duration_seconds?: number | null
          voice_note_path?: string | null
          voice_note_recorded_at?: string | null
          voice_note_recorded_by?: string | null
        }
        Update: {
          client_name?: string | null
          created_at?: string | null
          created_by?: string
          deadline?: string | null
          deleted_at?: string | null
          dossier_id?: string | null
          error_msg?: string | null
          id?: string
          opportunity_score?: number | null
          organization_id?: string | null
          outcome?: Database["public"]["Enums"]["tender_outcome"] | null
          outcome_at?: string | null
          outcome_reason?: string | null
          outcome_set_by?: string | null
          outcome_tag?: Database["public"]["Enums"]["tender_outcome_tag"] | null
          status?: Database["public"]["Enums"]["tender_status"]
          title?: string
          updated_at?: string | null
          voice_note_duration_seconds?: number | null
          voice_note_path?: string | null
          voice_note_recorded_at?: string | null
          voice_note_recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_outcome_set_by_fkey"
            columns: ["outcome_set_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_voice_note_recorded_by_fkey"
            columns: ["voice_note_recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trace_embeddings: {
        Row: {
          created_at: string | null
          embedding: string
          id: string
          site_id: string
          source_id: string
          source_type: string
          text_excerpt: string
        }
        Insert: {
          created_at?: string | null
          embedding: string
          id?: string
          site_id: string
          source_id: string
          source_type: string
          text_excerpt: string
        }
        Update: {
          created_at?: string | null
          embedding?: string
          id?: string
          site_id?: string
          source_id?: string
          source_type?: string
          text_excerpt?: string
        }
        Relationships: [
          {
            foreignKeyName: "trace_embeddings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          ai_artifact_id: string | null
          ai_artifact_type: string | null
          ai_capability: string | null
          ai_dedupe_key: string | null
          ai_edit_ratio: number | null
          ai_latency_seconds: number | null
          ai_outcome: string | null
          ai_run_id: string | null
          created_at: string
          event: string
          id: string
          meta: Json | null
          organization_id: string | null
          site_id: string | null
          user_id: string | null
        }
        Insert: {
          ai_artifact_id?: string | null
          ai_artifact_type?: string | null
          ai_capability?: string | null
          ai_dedupe_key?: string | null
          ai_edit_ratio?: number | null
          ai_latency_seconds?: number | null
          ai_outcome?: string | null
          ai_run_id?: string | null
          created_at?: string
          event: string
          id?: string
          meta?: Json | null
          organization_id?: string | null
          site_id?: string | null
          user_id?: string | null
        }
        Update: {
          ai_artifact_id?: string | null
          ai_artifact_type?: string | null
          ai_capability?: string | null
          ai_dedupe_key?: string | null
          ai_edit_ratio?: number | null
          ai_latency_seconds?: number | null
          ai_outcome?: string | null
          ai_run_id?: string | null
          created_at?: string
          event?: string
          id?: string
          meta?: Json | null
          organization_id?: string | null
          site_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feed_state: {
        Row: {
          last_seen_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          commune: string | null
          contract_end_date: string | null
          created_at: string | null
          deleted_at: string | null
          email: string
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          full_name: string | null
          id: string
          must_change_password: boolean | null
          organization_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          theme_preference: string | null
        }
        Insert: {
          commune?: string | null
          contract_end_date?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email: string
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          full_name?: string | null
          id: string
          must_change_password?: boolean | null
          organization_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          theme_preference?: string | null
        }
        Update: {
          commune?: string | null
          contract_end_date?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          full_name?: string | null
          id?: string
          must_change_password?: boolean | null
          organization_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          theme_preference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_capture: {
        Row: {
          ai_prepared: Json | null
          annotated_original_id: string | null
          attachment_id: string | null
          body: string | null
          captured_at: string | null
          captured_at_source: string | null
          client_uuid: string | null
          created_at: string
          created_by: string | null
          dossier_id: string | null
          hidden_at: string | null
          id: string
          is_viewpoint: boolean
          kind: string
          lat: number | null
          lng: number | null
          organization_id: string | null
          processing_at: string | null
          processing_attempts: number
          processing_error: string | null
          processing_stage: string
          report_id: string
          site_id: string
          starred: boolean
          status: string
          subject_id: string | null
          suite_status: string | null
          transcript_status: string | null
          triage_intent: string | null
          tsv: unknown
          updated_at: string
          viewpoint_of: string | null
        }
        Insert: {
          ai_prepared?: Json | null
          annotated_original_id?: string | null
          attachment_id?: string | null
          body?: string | null
          captured_at?: string | null
          captured_at_source?: string | null
          client_uuid?: string | null
          created_at?: string
          created_by?: string | null
          dossier_id?: string | null
          hidden_at?: string | null
          id?: string
          is_viewpoint?: boolean
          kind: string
          lat?: number | null
          lng?: number | null
          organization_id?: string | null
          processing_at?: string | null
          processing_attempts?: number
          processing_error?: string | null
          processing_stage?: string
          report_id: string
          site_id: string
          starred?: boolean
          status?: string
          subject_id?: string | null
          suite_status?: string | null
          transcript_status?: string | null
          triage_intent?: string | null
          tsv?: unknown
          updated_at?: string
          viewpoint_of?: string | null
        }
        Update: {
          ai_prepared?: Json | null
          annotated_original_id?: string | null
          attachment_id?: string | null
          body?: string | null
          captured_at?: string | null
          captured_at_source?: string | null
          client_uuid?: string | null
          created_at?: string
          created_by?: string | null
          dossier_id?: string | null
          hidden_at?: string | null
          id?: string
          is_viewpoint?: boolean
          kind?: string
          lat?: number | null
          lng?: number | null
          organization_id?: string | null
          processing_at?: string | null
          processing_attempts?: number
          processing_error?: string | null
          processing_stage?: string
          report_id?: string
          site_id?: string
          starred?: boolean
          status?: string
          subject_id?: string | null
          suite_status?: string | null
          transcript_status?: string | null
          triage_intent?: string | null
          tsv?: unknown
          updated_at?: string
          viewpoint_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_capture_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "site_report_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_capture_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_capture_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_capture_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_capture_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_capture_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_capture_viewpoint_of_fkey"
            columns: ["viewpoint_of"]
            isOneToOne: false
            referencedRelation: "visit_capture"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_capture_routes: {
        Row: {
          capture_id: string
          created_at: string
          created_by: string | null
          destination: string
          id: string
          organization_id: string | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          capture_id: string
          created_at?: string
          created_by?: string | null
          destination: string
          id?: string
          organization_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          capture_id?: string
          created_at?: string
          created_by?: string | null
          destination?: string
          id?: string
          organization_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_capture_routes_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "visit_capture"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_capture_routes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_capture_watchlist_item: {
        Row: {
          capture_id: string
          created_at: string
          id: string
          item_id: string
        }
        Insert: {
          capture_id: string
          created_at?: string
          id?: string
          item_id: string
        }
        Update: {
          capture_id?: string
          created_at?: string
          id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_capture_watchlist_item_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "visit_capture"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_capture_watchlist_item_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "visit_watchlist_item"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_watchlist_item: {
        Row: {
          capture_id: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string
          note: string | null
          organization_id: string | null
          position: number
          priority: string
          promoted_ref: string | null
          promoted_to: string | null
          reason: string | null
          report_id: string
          site_id: string
          source_kind: string | null
          source_ref: string | null
          state: string
          updated_at: string
        }
        Insert: {
          capture_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          note?: string | null
          organization_id?: string | null
          position?: number
          priority?: string
          promoted_ref?: string | null
          promoted_to?: string | null
          reason?: string | null
          report_id: string
          site_id: string
          source_kind?: string | null
          source_ref?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          capture_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          note?: string | null
          organization_id?: string | null
          position?: number
          priority?: string
          promoted_ref?: string | null
          promoted_to?: string | null
          reason?: string | null
          report_id?: string
          site_id?: string
          source_kind?: string | null
          source_ref?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_watchlist_item_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "visit_capture"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_watchlist_item_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "site_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_watchlist_item_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      backup_list_tables: { Args: never; Returns: string[] }
      contract_summaries: {
        Args: { p_contract_ids: string[] }
        Returns: {
          confidence_level: string
          contract_id: string
          engagements_total: number
          executed: number
          needs_attention: boolean
          planned: number
          proof_coverage: number
          proven: number
          validated: number
        }[]
      }
      current_user_org_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      exec_sql: { Args: { sql: string }; Returns: undefined }
      find_similar_engagements: {
        Args: {
          p_exclude_tender_id?: string
          p_limit?: number
          p_query: string
          p_threshold?: number
        }
        Returns: {
          ai_confidence: number
          category: Database["public"]["Enums"]["engagement_category"]
          contract_id: string
          created_at: string
          created_by: string
          id: string
          measurable: boolean
          short_label: string
          similarity: number
          source_excerpt: string
          source_ref: Json
          source_type: Database["public"]["Enums"]["engagement_source_type"]
          status: Database["public"]["Enums"]["engagement_status"]
          tender_id: string
          updated_at: string
        }[]
      }
      find_similar_knowledge_chunks: {
        Args: {
          p_embedding: string
          p_limit?: number
          p_source_domains?: string[]
          p_tenant_id: string
          p_threshold?: number
        }
        Returns: {
          chunk_index: number
          chunk_text: string
          metadata: Json
          similarity: number
          source_domain: string
          source_id: string
          source_type: string
        }[]
      }
      find_similar_tender_memory: {
        Args: {
          p_client_name: string
          p_current_tender_id: string
          p_limit?: number
          p_threshold?: number
          p_title: string
        }
        Returns: {
          client_name: string
          id: string
          outcome: Database["public"]["Enums"]["tender_outcome"]
          outcome_at: string
          outcome_reason: string
          outcome_tag: Database["public"]["Enums"]["tender_outcome_tag"]
          similarity: number
          title: string
        }[]
      }
      find_similar_to_source: {
        Args: { p_limit?: number; p_source_id: string; p_target_type: string }
        Returns: {
          similarity: number
          source_id: string
          text_excerpt: string
        }[]
      }
      find_similar_traces: {
        Args: {
          p_exclude_source_id?: string
          p_limit?: number
          p_query_embedding: string
          p_site_id: string
        }
        Returns: {
          similarity: number
          source_id: string
          source_type: string
          text_excerpt: string
        }[]
      }
      find_similar_traces_for_tenant: {
        Args: {
          p_embedding: string
          p_limit?: number
          p_source_types?: string[]
          p_tenant_id: string
          p_threshold?: number
        }
        Returns: {
          similarity: number
          site_id: string
          source_id: string
          source_type: string
          text_excerpt: string
        }[]
      }
      fn_complete_action: {
        Args: {
          p_actor_id?: string
          p_comment?: string
          p_id: string
          p_photo?: string
        }
        Returns: string
      }
      fn_reopen_action: {
        Args: { p_actor_id?: string; p_id: string; p_reason?: string }
        Returns: string
      }
      fn_update_action: {
        Args: { p_actor_id?: string; p_id: string; p_patch: Json }
        Returns: string
      }
      is_referent_of_intervention: {
        Args: { p_intervention: string }
        Returns: boolean
      }
      is_safe_team_color: { Args: { c: string }; Returns: boolean }
      is_safe_team_icon: { Args: { i: string }; Returns: boolean }
      is_safe_team_specialties: { Args: { arr: string[] }; Returns: boolean }
      is_team_member_of_intervention: {
        Args: { p_intervention: string }
        Returns: boolean
      }
      materialize_historical_visit: {
        Args: {
          p_run_id: string
          p_site_id: string
          p_user_id: string
          p_visit_date: string
          p_visit_title?: string
        }
        Returns: string
      }
      record_intervention_token_access: {
        Args: { p_token: string }
        Returns: undefined
      }
      record_share_access: {
        Args: {
          p_ip?: unknown
          p_kind: string
          p_token_id: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      search_memory: {
        Args: {
          p_contract_id?: string
          p_limit?: number
          p_org_id?: string
          p_period_days?: number
          p_q: string
          p_site_id?: string
        }
        Returns: {
          contract_id: string
          id: string
          occurred_at: string
          rank: number
          site_id: string
          snippet: string
          subject_id: string
          title: string
          type: string
        }[]
      }
    }
    Enums: {
      access_event_source: "pc_securite" | "spi" | "accueil" | "autre"
      access_event_type: "pickup" | "return" | "incident"
      agent_analysis_status: "pending" | "running" | "ready" | "failed"
      ai_provider: "mock" | "gemini" | "anthropic" | "openai"
      anomaly_category:
        | "eau_coupee"
        | "materiel_casse"
        | "acces_bloque"
        | "produit_manquant"
        | "autre"
        | "electricite_coupee"
        | "zone_non_prete"
        | "danger_securite"
        | "livraison_probleme"
      anomaly_status: "open" | "resolved" | "ignored"
      contract_status: "active" | "paused" | "terminated" | "archived"
      employment_type: "cdi" | "cdd" | "cdi_chantier"
      engagement_category:
        | "frequency"
        | "quality"
        | "compliance"
        | "delivery"
        | "sla"
        | "reporting"
        | "other"
      engagement_source_type: "ao_clause" | "memoire_engagement" | "manual"
      engagement_status:
        | "extracted"
        | "curated"
        | "active"
        | "completed"
        | "archived"
      incident_severity: "low" | "medium" | "high" | "critical"
      intervention_status:
        | "planned"
        | "in_progress"
        | "completed"
        | "validated"
        | "skipped"
      knowledge_category:
        | "references_clients"
        | "moyens_humains"
        | "materiel"
        | "procedures"
        | "qualite"
        | "anciens_memoires"
      mission_cadence: "daily" | "weekly" | "biweekly" | "monthly" | "on_demand"
      photo_kind:
        | "before"
        | "after"
        | "anomaly"
        | "proof"
        | "passage"
        | "access"
      tender_outcome: "pending" | "won" | "lost" | "withdrawn" | "not_responded"
      tender_outcome_tag: "prix" | "qualite" | "relation" | "timing" | "autre"
      tender_status:
        | "draft"
        | "extracting"
        | "analyzing"
        | "ready"
        | "failed"
        | "submitted"
        | "archived"
      user_role: "admin" | "manager" | "chef_equipe"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_event_source: ["pc_securite", "spi", "accueil", "autre"],
      access_event_type: ["pickup", "return", "incident"],
      agent_analysis_status: ["pending", "running", "ready", "failed"],
      ai_provider: ["mock", "gemini", "anthropic", "openai"],
      anomaly_category: [
        "eau_coupee",
        "materiel_casse",
        "acces_bloque",
        "produit_manquant",
        "autre",
        "electricite_coupee",
        "zone_non_prete",
        "danger_securite",
        "livraison_probleme",
      ],
      anomaly_status: ["open", "resolved", "ignored"],
      contract_status: ["active", "paused", "terminated", "archived"],
      employment_type: ["cdi", "cdd", "cdi_chantier"],
      engagement_category: [
        "frequency",
        "quality",
        "compliance",
        "delivery",
        "sla",
        "reporting",
        "other",
      ],
      engagement_source_type: ["ao_clause", "memoire_engagement", "manual"],
      engagement_status: [
        "extracted",
        "curated",
        "active",
        "completed",
        "archived",
      ],
      incident_severity: ["low", "medium", "high", "critical"],
      intervention_status: [
        "planned",
        "in_progress",
        "completed",
        "validated",
        "skipped",
      ],
      knowledge_category: [
        "references_clients",
        "moyens_humains",
        "materiel",
        "procedures",
        "qualite",
        "anciens_memoires",
      ],
      mission_cadence: ["daily", "weekly", "biweekly", "monthly", "on_demand"],
      photo_kind: ["before", "after", "anomaly", "proof", "passage", "access"],
      tender_outcome: ["pending", "won", "lost", "withdrawn", "not_responded"],
      tender_outcome_tag: ["prix", "qualite", "relation", "timing", "autre"],
      tender_status: [
        "draft",
        "extracting",
        "analyzing",
        "ready",
        "failed",
        "submitted",
        "archived",
      ],
      user_role: ["admin", "manager", "chef_equipe"],
    },
  },
} as const
