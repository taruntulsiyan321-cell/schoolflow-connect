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
    PostgrestVersion: "14.15"
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
      academic_agent_cache: {
        Row: {
          agent_type: string
          created_at: string
          expires_at: string | null
          id: string
          payload: Json
          school_id: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_type: string
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json
          school_id?: string | null
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_type?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json
          school_id?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_agent_cache_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_audit: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          new_value: Json | null
          previous_value: Json | null
          school_id: string
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          new_value?: Json | null
          previous_value?: Json | null
          school_id?: string
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          new_value?: Json | null
          previous_value?: Json | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_audit_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_daily_activity: {
        Row: {
          activity_date: string
          battle_count: number
          dpp_count: number
          homework_count: number
          practice_minutes: number
          school_id: string | null
          self_practice_count: number
          user_id: string
        }
        Insert: {
          activity_date: string
          battle_count?: number
          dpp_count?: number
          homework_count?: number
          practice_minutes?: number
          school_id?: string | null
          self_practice_count?: number
          user_id: string
        }
        Update: {
          activity_date?: string
          battle_count?: number
          dpp_count?: number
          homework_count?: number
          practice_minutes?: number
          school_id?: string | null
          self_practice_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_daily_activity_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_events: {
        Row: {
          actor_user_id: string | null
          class_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          error: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          school_id: string
          status: Database["public"]["Enums"]["academic_event_status"]
          student_id: string | null
          teacher_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          class_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          error?: string | null
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          school_id?: string
          status?: Database["public"]["Enums"]["academic_event_status"]
          student_id?: string | null
          teacher_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          class_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          school_id?: string
          status?: Database["public"]["Enums"]["academic_event_status"]
          student_id?: string | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academic_events_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_events_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_taxonomy_terms: {
        Row: {
          aliases: Json
          board: string | null
          class_level: number | null
          created_at: string
          description: string | null
          display_name: string
          id: string
          keywords: Json
          kind: string
          parent_term_id: string | null
          subject: string | null
          term_id: string
          updated_at: string
        }
        Insert: {
          aliases?: Json
          board?: string | null
          class_level?: number | null
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          keywords?: Json
          kind: string
          parent_term_id?: string | null
          subject?: string | null
          term_id: string
          updated_at?: string
        }
        Update: {
          aliases?: Json
          board?: string | null
          class_level?: number | null
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          keywords?: Json
          kind?: string
          parent_term_id?: string | null
          subject?: string | null
          term_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      academic_terms: {
        Row: {
          academic_year: string
          academic_year_id: string | null
          created_at: string
          ends_on: string
          id: string
          is_current: boolean
          name: string
          school_id: string
          starts_on: string
        }
        Insert: {
          academic_year: string
          academic_year_id?: string | null
          created_at?: string
          ends_on: string
          id?: string
          is_current?: boolean
          name: string
          school_id?: string
          starts_on: string
        }
        Update: {
          academic_year?: string
          academic_year_id?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          is_current?: boolean
          name?: string
          school_id?: string
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_terms_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_terms_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_years: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          is_current: boolean
          name: string
          school_id: string
          starts_on: string
          status: Database["public"]["Enums"]["academic_year_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          is_current?: boolean
          name: string
          school_id?: string
          starts_on: string
          status?: Database["public"]["Enums"]["academic_year_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          is_current?: boolean
          name?: string
          school_id?: string
          starts_on?: string
          status?: Database["public"]["Enums"]["academic_year_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_years_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_answer_cache: {
        Row: {
          answer: string
          chapter: string | null
          class_level: number | null
          concept: string | null
          created_at: string
          embedding: string | null
          hit_count: number
          id: string
          last_used_at: string | null
          model_id: string | null
          original_question: string
          request_id: string | null
          review_status: string
          school_id: string | null
          source_type: string
          subject: string | null
          topic: string | null
        }
        Insert: {
          answer: string
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          created_at?: string
          embedding?: string | null
          hit_count?: number
          id?: string
          last_used_at?: string | null
          model_id?: string | null
          original_question: string
          request_id?: string | null
          review_status?: string
          school_id?: string | null
          source_type?: string
          subject?: string | null
          topic?: string | null
        }
        Update: {
          answer?: string
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          created_at?: string
          embedding?: string | null
          hit_count?: number
          id?: string
          last_used_at?: string | null
          model_id?: string | null
          original_question?: string
          request_id?: string | null
          review_status?: string
          school_id?: string | null
          source_type?: string
          subject?: string | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_answer_cache_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_benchmark_fixtures: {
        Row: {
          created_at: string
          expected: Json
          fixture_key: string
          id: string
          input: Json
          metadata: Json
          suite_id: string
        }
        Insert: {
          created_at?: string
          expected?: Json
          fixture_key: string
          id?: string
          input?: Json
          metadata?: Json
          suite_id: string
        }
        Update: {
          created_at?: string
          expected?: Json
          fixture_key?: string
          id?: string
          input?: Json
          metadata?: Json
          suite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_benchmark_fixtures_suite_id_fkey"
            columns: ["suite_id"]
            isOneToOne: false
            referencedRelation: "ai_benchmark_suite_defs"
            referencedColumns: ["suite_id"]
          },
        ]
      }
      ai_benchmark_runs: {
        Row: {
          baseline_score: number | null
          candidate_label: string
          candidate_score: number | null
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          passed: boolean | null
          scorecard: Json
          status: string
          suite_id: string
        }
        Insert: {
          baseline_score?: number | null
          candidate_label: string
          candidate_score?: number | null
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          passed?: boolean | null
          scorecard?: Json
          status?: string
          suite_id: string
        }
        Update: {
          baseline_score?: number | null
          candidate_label?: string
          candidate_score?: number | null
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          passed?: boolean | null
          scorecard?: Json
          status?: string
          suite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_benchmark_runs_suite_id_fkey"
            columns: ["suite_id"]
            isOneToOne: false
            referencedRelation: "ai_benchmark_suite_defs"
            referencedColumns: ["suite_id"]
          },
        ]
      }
      ai_benchmark_suite_defs: {
        Row: {
          created_at: string
          critical: boolean
          description: string
          metadata: Json
          name: string
          suite_id: string
        }
        Insert: {
          created_at?: string
          critical?: boolean
          description?: string
          metadata?: Json
          name: string
          suite_id: string
        }
        Update: {
          created_at?: string
          critical?: boolean
          description?: string
          metadata?: Json
          name?: string
          suite_id?: string
        }
        Relationships: []
      }
      ai_budget_quotas: {
        Row: {
          feature_id: string | null
          hard_limit_units: number | null
          id: string
          metadata: Json
          period: string
          school_id: string
          scope: string
          soft_limit_units: number
          updated_at: string
        }
        Insert: {
          feature_id?: string | null
          hard_limit_units?: number | null
          id?: string
          metadata?: Json
          period: string
          school_id: string
          scope: string
          soft_limit_units: number
          updated_at?: string
        }
        Update: {
          feature_id?: string | null
          hard_limit_units?: number | null
          id?: string
          metadata?: Json
          period?: string
          school_id?: string
          scope?: string
          soft_limit_units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_budget_quotas_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_budget_usage: {
        Row: {
          feature_id: string | null
          id: string
          period: string
          period_key: string
          school_id: string
          units_used: number
          updated_at: string
        }
        Insert: {
          feature_id?: string | null
          id?: string
          period: string
          period_key: string
          school_id: string
          units_used?: number
          updated_at?: string
        }
        Update: {
          feature_id?: string | null
          id?: string
          period?: string
          period_key?: string
          school_id?: string
          units_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_budget_usage_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_embedding_jobs: {
        Row: {
          attempts: number
          chunk_id: string
          completed_at: string | null
          created_at: string
          document_id: string
          id: string
          last_error: string | null
          metadata: Json
          provider_hint: string
          school_id: string
          status: string
          updated_at: string
          version_id: string
        }
        Insert: {
          attempts?: number
          chunk_id: string
          completed_at?: string | null
          created_at?: string
          document_id: string
          id?: string
          last_error?: string | null
          metadata?: Json
          provider_hint?: string
          school_id: string
          status?: string
          updated_at?: string
          version_id: string
        }
        Update: {
          attempts?: number
          chunk_id?: string
          completed_at?: string | null
          created_at?: string
          document_id?: string
          id?: string
          last_error?: string | null
          metadata?: Json
          provider_hint?: string
          school_id?: string
          status?: string
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_embedding_jobs_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: true
            referencedRelation: "ai_kms_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_embedding_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ai_kms_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_embedding_jobs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_embedding_jobs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "ai_kms_document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_explanations: {
        Row: {
          cache_key: string
          created_at: string
          created_by: string | null
          payload: Json
          school_id: string | null
          student_id: string | null
          subject: string | null
          topic: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string
          created_by?: string | null
          payload: Json
          school_id?: string | null
          student_id?: string | null
          subject?: string | null
          topic?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string
          created_by?: string | null
          payload?: Json
          school_id?: string | null
          student_id?: string | null
          subject?: string | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_explanations_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_explanations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_feature_flags: {
        Row: {
          enabled: boolean
          flag_key: string
          id: string
          metadata: Json
          school_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          flag_key: string
          id?: string
          metadata?: Json
          school_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          flag_key?: string
          id?: string
          metadata?: Json
          school_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_feature_flags_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_feedback_signals: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          comment_redacted: string | null
          created_at: string
          feature_id: string | null
          id: string
          metadata: Json
          rating: number | null
          request_id: string | null
          school_id: string | null
          signal_type: string
          target_kind: string
          target_ref: string | null
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          comment_redacted?: string | null
          created_at?: string
          feature_id?: string | null
          id?: string
          metadata?: Json
          rating?: number | null
          request_id?: string | null
          school_id?: string | null
          signal_type: string
          target_kind?: string
          target_ref?: string | null
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          comment_redacted?: string | null
          created_at?: string
          feature_id?: string | null
          id?: string
          metadata?: Json
          rating?: number | null
          request_id?: string | null
          school_id?: string | null
          signal_type?: string
          target_kind?: string
          target_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_feedback_signals_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_kms_approval_audit: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          detail: Json
          document_id: string
          id: string
          version_id: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          document_id: string
          id?: string
          version_id?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          document_id?: string
          id?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_kms_approval_audit_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ai_kms_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_kms_approval_audit_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "ai_kms_document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_kms_chunks: {
        Row: {
          chunk_index: number
          chunk_metadata: Json
          chunk_text: string
          created_at: string
          document_id: string
          embed_status: string
          embedded_at: string | null
          embedding: string | null
          embedding_compat: number[] | null
          embedding_model_version: string | null
          embedding_stub: Json
          id: string
          published: boolean
          version_id: string
        }
        Insert: {
          chunk_index: number
          chunk_metadata?: Json
          chunk_text?: string
          created_at?: string
          document_id: string
          embed_status?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_compat?: number[] | null
          embedding_model_version?: string | null
          embedding_stub?: Json
          id?: string
          published?: boolean
          version_id: string
        }
        Update: {
          chunk_index?: number
          chunk_metadata?: Json
          chunk_text?: string
          created_at?: string
          document_id?: string
          embed_status?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_compat?: number[] | null
          embedding_model_version?: string | null
          embedding_stub?: Json
          id?: string
          published?: boolean
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_kms_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ai_kms_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_kms_chunks_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "ai_kms_document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_kms_document_versions: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          chunk_count: number
          content_hash: string | null
          created_at: string
          created_by: string | null
          document_id: string
          embedding_status: string
          id: string
          quality_score: number | null
          raw_text: string | null
          rejection_reason: string | null
          source_uri: string | null
          version: number
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          chunk_count?: number
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          document_id: string
          embedding_status?: string
          id?: string
          quality_score?: number | null
          raw_text?: string | null
          rejection_reason?: string | null
          source_uri?: string | null
          version: number
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          chunk_count?: number
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          document_id?: string
          embedding_status?: string
          id?: string
          quality_score?: number | null
          raw_text?: string | null
          rejection_reason?: string | null
          source_uri?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_kms_document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ai_kms_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_kms_documents: {
        Row: {
          board: string | null
          chapter: string | null
          content_type: string
          created_at: string
          current_version: number
          grade: string | null
          id: string
          language: string
          metadata: Json
          owner_user_id: string | null
          school_id: string
          status: string
          subject: string | null
          tenant_scope: string
          title: string
          updated_at: string
          visibility_scope: string[]
        }
        Insert: {
          board?: string | null
          chapter?: string | null
          content_type?: string
          created_at?: string
          current_version?: number
          grade?: string | null
          id?: string
          language?: string
          metadata?: Json
          owner_user_id?: string | null
          school_id: string
          status?: string
          subject?: string | null
          tenant_scope?: string
          title: string
          updated_at?: string
          visibility_scope?: string[]
        }
        Update: {
          board?: string | null
          chapter?: string | null
          content_type?: string
          created_at?: string
          current_version?: number
          grade?: string | null
          id?: string
          language?: string
          metadata?: Json
          owner_user_id?: string | null
          school_id?: string
          status?: string
          subject?: string | null
          tenant_scope?: string
          title?: string
          updated_at?: string
          visibility_scope?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "ai_kms_documents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_prompt_library: {
        Row: {
          audience: string
          benchmark_run_ids: string[]
          caching_eligible: boolean
          capability_id: string
          created_at: string
          id: string
          max_output_tokens: number
          metadata: Json
          output_schema: Json
          promoted_at: string | null
          promoted_by: string | null
          rollback_version: string | null
          scorecard: Json
          status: string
          system_template: string
          temperature: number
          updated_at: string
          user_template: string
          version: string
        }
        Insert: {
          audience?: string
          benchmark_run_ids?: string[]
          caching_eligible?: boolean
          capability_id: string
          created_at?: string
          id?: string
          max_output_tokens?: number
          metadata?: Json
          output_schema?: Json
          promoted_at?: string | null
          promoted_by?: string | null
          rollback_version?: string | null
          scorecard?: Json
          status?: string
          system_template: string
          temperature?: number
          updated_at?: string
          user_template?: string
          version: string
        }
        Update: {
          audience?: string
          benchmark_run_ids?: string[]
          caching_eligible?: boolean
          capability_id?: string
          created_at?: string
          id?: string
          max_output_tokens?: number
          metadata?: Json
          output_schema?: Json
          promoted_at?: string | null
          promoted_by?: string | null
          rollback_version?: string | null
          scorecard?: Json
          status?: string
          system_template?: string
          temperature?: number
          updated_at?: string
          user_template?: string
          version?: string
        }
        Relationships: []
      }
      ai_request_decisions: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          budget_tier: string | null
          cache_hit: boolean
          confidence: number | null
          created_at: string
          decision: string
          error_code: string | null
          estimated_cost_units: number | null
          evidence: Json
          feature_id: string
          id: string
          kill_switch_hit: string | null
          latency_ms: number | null
          model_id: string | null
          request_id: string
          route_class: string
          school_id: string | null
          used_model: boolean
          validation_ok: boolean | null
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          budget_tier?: string | null
          cache_hit?: boolean
          confidence?: number | null
          created_at?: string
          decision: string
          error_code?: string | null
          estimated_cost_units?: number | null
          evidence?: Json
          feature_id: string
          id?: string
          kill_switch_hit?: string | null
          latency_ms?: number | null
          model_id?: string | null
          request_id: string
          route_class: string
          school_id?: string | null
          used_model?: boolean
          validation_ok?: boolean | null
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          budget_tier?: string | null
          cache_hit?: boolean
          confidence?: number | null
          created_at?: string
          decision?: string
          error_code?: string | null
          estimated_cost_units?: number | null
          evidence?: Json
          feature_id?: string
          id?: string
          kill_switch_hit?: string | null
          latency_ms?: number | null
          model_id?: string | null
          request_id?: string
          route_class?: string
          school_id?: string | null
          used_model?: boolean
          validation_ok?: boolean | null
        }
        Relationships: []
      }
      ai_session_memory: {
        Row: {
          actor_role: string
          actor_user_id: string
          capability_id: string | null
          closed_at: string | null
          created_at: string
          expires_at: string
          id: string
          metadata: Json
          school_id: string
          status: string
          summary: Json
          target_student_id: string | null
          turn_count: number
          updated_at: string
          workflow_id: string | null
          workflow_scope: string
        }
        Insert: {
          actor_role: string
          actor_user_id: string
          capability_id?: string | null
          closed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          metadata?: Json
          school_id: string
          status?: string
          summary?: Json
          target_student_id?: string | null
          turn_count?: number
          updated_at?: string
          workflow_id?: string | null
          workflow_scope: string
        }
        Update: {
          actor_role?: string
          actor_user_id?: string
          capability_id?: string | null
          closed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          metadata?: Json
          school_id?: string
          status?: string
          summary?: Json
          target_student_id?: string | null
          turn_count?: number
          updated_at?: string
          workflow_id?: string | null
          workflow_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_session_memory_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_solution_cache: {
        Row: {
          cache_key: string
          created_at: string
          data_version: string | null
          expires_at: string | null
          feature_id: string
          id: string
          payload: Json
          school_id: string
          student_id: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string
          data_version?: string | null
          expires_at?: string | null
          feature_id: string
          id?: string
          payload: Json
          school_id: string
          student_id?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string
          data_version?: string | null
          expires_at?: string | null
          feature_id?: string
          id?: string
          payload?: Json
          school_id?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_solution_cache_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_workflow_registry: {
        Row: {
          capability_id: string
          enabled: boolean
          metadata: Json
          updated_at: string
          version: string
          workflow_id: string
        }
        Insert: {
          capability_id: string
          enabled?: boolean
          metadata?: Json
          updated_at?: string
          version: string
          workflow_id: string
        }
        Update: {
          capability_id?: string
          enabled?: boolean
          metadata?: Json
          updated_at?: string
          version?: string
          workflow_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          currency: string
          enable_fees: boolean
          enable_leaves: boolean
          enable_notices: boolean
          locale: string
          school_id: string
          school_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          currency?: string
          enable_fees?: boolean
          enable_leaves?: boolean
          enable_notices?: boolean
          locale?: string
          school_id: string
          school_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          currency?: string
          enable_fees?: boolean
          enable_leaves?: boolean
          enable_notices?: boolean
          locale?: string
          school_id?: string
          school_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          related_leave_id: string | null
          related_notice_id: string | null
          request_type: string
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          school_id: string
          status: string
          title: string
          urgency: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          related_leave_id?: string | null
          related_notice_id?: string | null
          request_type: string
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          school_id?: string
          status?: string
          title: string
          urgency?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          related_leave_id?: string | null
          related_notice_id?: string | null
          request_type?: string
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          school_id?: string
          status?: string
          title?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_related_leave_id_fkey"
            columns: ["related_leave_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_related_notice_id_fkey"
            columns: ["related_notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          class_id: string
          created_at: string
          date: string
          id: string
          marked_by: string | null
          school_id: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
          school_id?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_audit: {
        Row: {
          attendance_id: string | null
          class_id: string | null
          date: string | null
          edited_at: string
          edited_by: string | null
          id: string
          new_status: string | null
          prev_status: string | null
          school_id: string | null
          student_id: string | null
        }
        Insert: {
          attendance_id?: string | null
          class_id?: string | null
          date?: string | null
          edited_at?: string
          edited_by?: string | null
          id?: string
          new_status?: string | null
          prev_status?: string | null
          school_id?: string | null
          student_id?: string | null
        }
        Update: {
          attendance_id?: string | null
          class_id?: string | null
          date?: string | null
          edited_at?: string
          edited_by?: string | null
          id?: string
          new_status?: string | null
          prev_status?: string | null
          school_id?: string | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_audit_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_locks: {
        Row: {
          class_id: string
          date: string
          locked_at: string
          locked_by: string | null
          school_id: string | null
        }
        Insert: {
          class_id: string
          date: string
          locked_at?: string
          locked_by?: string | null
          school_id?: string | null
        }
        Update: {
          class_id?: string
          date?: string
          locked_at?: string
          locked_by?: string | null
          school_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_locks_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_locks_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          metadata: Json | null
          school_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json | null
          school_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json | null
          school_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_verify_attempts: {
        Row: {
          created_at: string
          error_code: string | null
          id: string
          identifier: string
          method: string
          success: boolean
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          id?: string
          identifier: string
          method: string
          success: boolean
        }
        Update: {
          created_at?: string
          error_code?: string | null
          id?: string
          identifier?: string
          method?: string
          success?: boolean
        }
        Relationships: []
      }
      battle_answers: {
        Row: {
          created_at: string
          id: string
          is_correct: boolean
          participant_id: string
          question_id: string
          school_id: string | null
          selected_index: number
          time_ms: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_correct: boolean
          participant_id: string
          question_id: string
          school_id?: string | null
          selected_index: number
          time_ms?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_correct?: boolean
          participant_id?: string
          question_id?: string
          school_id?: string | null
          selected_index?: number
          time_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "battle_answers_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "battle_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "battle_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_answers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_events: {
        Row: {
          actor_name: string
          actor_user_id: string
          battle_id: string | null
          class_id: string | null
          created_at: string
          detail: string
          icon: string | null
          id: string
          kind: string
          opponent_name: string | null
          school_id: string | null
          subject: string | null
        }
        Insert: {
          actor_name?: string
          actor_user_id: string
          battle_id?: string | null
          class_id?: string | null
          created_at?: string
          detail: string
          icon?: string | null
          id?: string
          kind: string
          opponent_name?: string | null
          school_id?: string | null
          subject?: string | null
        }
        Update: {
          actor_name?: string
          actor_user_id?: string
          battle_id?: string | null
          class_id?: string | null
          created_at?: string
          detail?: string
          icon?: string | null
          id?: string
          kind?: string
          opponent_name?: string | null
          school_id?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "battle_events_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_invites: {
        Row: {
          battle_id: string
          created_at: string
          id: string
          invited_user_id: string
          inviter_user_id: string
          school_id: string | null
          status: string
        }
        Insert: {
          battle_id: string
          created_at?: string
          id?: string
          invited_user_id: string
          inviter_user_id: string
          school_id?: string | null
          status?: string
        }
        Update: {
          battle_id?: string
          created_at?: string
          id?: string
          invited_user_id?: string
          inviter_user_id?: string
          school_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "battle_invites_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_invites_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_participants: {
        Row: {
          answered_count: number
          battle_id: string
          correct_count: number
          display_name: string
          finished_at: string | null
          id: string
          joined_at: string
          rank: number | null
          school_id: string | null
          score: number
          student_id: string | null
          total_time_ms: number
          user_id: string
        }
        Insert: {
          answered_count?: number
          battle_id: string
          correct_count?: number
          display_name?: string
          finished_at?: string | null
          id?: string
          joined_at?: string
          rank?: number | null
          school_id?: string | null
          score?: number
          student_id?: string | null
          total_time_ms?: number
          user_id: string
        }
        Update: {
          answered_count?: number
          battle_id?: string
          correct_count?: number
          display_name?: string
          finished_at?: string | null
          id?: string
          joined_at?: string
          rank?: number | null
          school_id?: string | null
          score?: number
          student_id?: string | null
          total_time_ms?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "battle_participants_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_participants_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_participants_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_questions: {
        Row: {
          bank_question_id: string | null
          battle_id: string
          concept: string | null
          correct_index: number
          id: string
          options: Json
          order_index: number
          points: number
          question: string
          school_id: string | null
          subconcept: string | null
        }
        Insert: {
          bank_question_id?: string | null
          battle_id: string
          concept?: string | null
          correct_index: number
          id?: string
          options: Json
          order_index: number
          points?: number
          question: string
          school_id?: string | null
          subconcept?: string | null
        }
        Update: {
          bank_question_id?: string | null
          battle_id?: string
          concept?: string | null
          correct_index?: number
          id?: string
          options?: Json
          order_index?: number
          points?: number
          question?: string
          school_id?: string | null
          subconcept?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "battle_questions_bank_question_id_fkey"
            columns: ["bank_question_id"]
            isOneToOne: false
            referencedRelation: "question_bank"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_questions_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_questions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_reports: {
        Row: {
          ai_insights: Json | null
          battle_id: string
          created_at: string
          display_name: string
          expires_at: string
          id: string
          participant_id: string
          report: Json
          school_id: string | null
          user_id: string
        }
        Insert: {
          ai_insights?: Json | null
          battle_id: string
          created_at?: string
          display_name?: string
          expires_at: string
          id?: string
          participant_id: string
          report: Json
          school_id?: string | null
          user_id: string
        }
        Update: {
          ai_insights?: Json | null
          battle_id?: string
          created_at?: string
          display_name?: string
          expires_at?: string
          id?: string
          participant_id?: string
          report?: Json
          school_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "battle_reports_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_reports_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "battle_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_reports_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      battles: {
        Row: {
          battle_code: string
          chapter: string | null
          class_id: string | null
          class_level: number | null
          created_at: string
          creator_user_id: string
          difficulty: string | null
          duration_sec: number
          id: string
          is_public: boolean
          mode: string
          per_question_sec: number
          question_count: number
          school_id: string | null
          source: string
          starts_at: string
          status: Database["public"]["Enums"]["battle_status"]
          subject: string
          title: string
          topic: string | null
          type: Database["public"]["Enums"]["battle_type"]
        }
        Insert: {
          battle_code: string
          chapter?: string | null
          class_id?: string | null
          class_level?: number | null
          created_at?: string
          creator_user_id: string
          difficulty?: string | null
          duration_sec?: number
          id?: string
          is_public?: boolean
          mode?: string
          per_question_sec?: number
          question_count?: number
          school_id?: string | null
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["battle_status"]
          subject: string
          title: string
          topic?: string | null
          type?: Database["public"]["Enums"]["battle_type"]
        }
        Update: {
          battle_code?: string
          chapter?: string | null
          class_id?: string | null
          class_level?: number | null
          created_at?: string
          creator_user_id?: string
          difficulty?: string | null
          duration_sec?: number
          id?: string
          is_public?: boolean
          mode?: string
          per_question_sec?: number
          question_count?: number
          school_id?: string | null
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["battle_status"]
          subject?: string
          title?: string
          topic?: string | null
          type?: Database["public"]["Enums"]["battle_type"]
        }
        Relationships: [
          {
            foreignKeyName: "battles_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          class_id: string | null
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          kind: string
          school_id: string
          title: string
          updated_at: string
        }
        Insert: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          dm_key?: string | null
          id?: string
          kind: string
          school_id: string
          title: string
          updated_at?: string
        }
        Update: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          dm_key?: string | null
          id?: string
          kind?: string
          school_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_participants: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          school_id: string | null
          unread_count: number
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          school_id?: string | null
          unread_count?: number
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          school_id?: string | null
          unread_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_participants_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      class_timetables: {
        Row: {
          class_id: string
          grid: Json
          school_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          class_id: string
          grid?: Json
          school_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          class_id?: string
          grid?: Json
          school_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_timetables_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: true
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_timetables_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          academic_year: string
          academic_year_id: string | null
          capacity: number | null
          category: string | null
          class_teacher_id: string | null
          created_at: string
          display_name: string | null
          id: string
          is_active: boolean
          kind: string
          name: string | null
          room_number: string | null
          school_id: string | null
          section: string | null
        }
        Insert: {
          academic_year?: string
          academic_year_id?: string | null
          capacity?: number | null
          category?: string | null
          class_teacher_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string | null
          room_number?: string | null
          school_id?: string | null
          section?: string | null
        }
        Update: {
          academic_year?: string
          academic_year_id?: string | null
          capacity?: number | null
          category?: string | null
          class_teacher_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string | null
          room_number?: string | null
          school_id?: string | null
          section?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_class_teacher_id_fkey"
            columns: ["class_teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      community_doubt_answer_attachments: {
        Row: {
          answer_id: string
          created_at: string
          created_by: string | null
          file_name: string
          file_size_bytes: number | null
          file_type: string | null
          id: string
          school_id: string | null
          storage_path: string
        }
        Insert: {
          answer_id: string
          created_at?: string
          created_by?: string | null
          file_name: string
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          school_id?: string | null
          storage_path: string
        }
        Update: {
          answer_id?: string
          created_at?: string
          created_by?: string | null
          file_name?: string
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          school_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_doubt_answer_attachments_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "community_doubt_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_doubt_answer_attachments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      community_doubt_answers: {
        Row: {
          author_name: string
          author_role: string
          body: string
          created_at: string
          doubt_id: string
          id: string
          image_url: string | null
          is_accepted: boolean
          is_teacher_verified: boolean
          school_id: string | null
          updated_at: string
          upvote_count: number
          user_id: string
        }
        Insert: {
          author_name?: string
          author_role?: string
          body: string
          created_at?: string
          doubt_id: string
          id?: string
          image_url?: string | null
          is_accepted?: boolean
          is_teacher_verified?: boolean
          school_id?: string | null
          updated_at?: string
          upvote_count?: number
          user_id: string
        }
        Update: {
          author_name?: string
          author_role?: string
          body?: string
          created_at?: string
          doubt_id?: string
          id?: string
          image_url?: string | null
          is_accepted?: boolean
          is_teacher_verified?: boolean
          school_id?: string | null
          updated_at?: string
          upvote_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_doubt_answers_doubt_id_fkey"
            columns: ["doubt_id"]
            isOneToOne: false
            referencedRelation: "community_doubts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_doubt_answers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      community_doubt_attachments: {
        Row: {
          created_at: string
          created_by: string | null
          doubt_id: string
          file_name: string
          file_size_bytes: number | null
          file_type: string | null
          id: string
          school_id: string | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doubt_id: string
          file_name: string
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          school_id?: string | null
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doubt_id?: string
          file_name?: string
          file_size_bytes?: number | null
          file_type?: string | null
          id?: string
          school_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_doubt_attachments_doubt_id_fkey"
            columns: ["doubt_id"]
            isOneToOne: false
            referencedRelation: "community_doubts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_doubt_attachments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      community_doubt_views: {
        Row: {
          doubt_id: string
          id: string
          school_id: string | null
          user_id: string
          viewed_at: string
        }
        Insert: {
          doubt_id: string
          id?: string
          school_id?: string | null
          user_id: string
          viewed_at?: string
        }
        Update: {
          doubt_id?: string
          id?: string
          school_id?: string | null
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_doubt_views_doubt_id_fkey"
            columns: ["doubt_id"]
            isOneToOne: false
            referencedRelation: "community_doubts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_doubt_views_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      community_doubt_votes: {
        Row: {
          answer_id: string | null
          created_at: string
          doubt_id: string | null
          id: string
          school_id: string | null
          user_id: string
        }
        Insert: {
          answer_id?: string | null
          created_at?: string
          doubt_id?: string | null
          id?: string
          school_id?: string | null
          user_id: string
        }
        Update: {
          answer_id?: string | null
          created_at?: string
          doubt_id?: string | null
          id?: string
          school_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_doubt_votes_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "community_doubt_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_doubt_votes_doubt_id_fkey"
            columns: ["doubt_id"]
            isOneToOne: false
            referencedRelation: "community_doubts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_doubt_votes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      community_doubts: {
        Row: {
          accepted_answer_id: string | null
          answer_count: number
          body: string
          chapter: string
          class_id: string | null
          class_label: string
          concept: string
          created_at: string
          id: string
          image_url: string | null
          last_activity_at: string
          school_id: string | null
          solved_at: string | null
          solved_by_answer_id: string | null
          status: string
          student_id: string | null
          student_name: string
          subject: string
          subject_id: string | null
          teacher_answered: boolean
          title: string
          updated_at: string
          upvote_count: number
          user_id: string
          view_count: number
        }
        Insert: {
          accepted_answer_id?: string | null
          answer_count?: number
          body: string
          chapter?: string
          class_id?: string | null
          class_label?: string
          concept?: string
          created_at?: string
          id?: string
          image_url?: string | null
          last_activity_at?: string
          school_id?: string | null
          solved_at?: string | null
          solved_by_answer_id?: string | null
          status?: string
          student_id?: string | null
          student_name?: string
          subject?: string
          subject_id?: string | null
          teacher_answered?: boolean
          title: string
          updated_at?: string
          upvote_count?: number
          user_id: string
          view_count?: number
        }
        Update: {
          accepted_answer_id?: string | null
          answer_count?: number
          body?: string
          chapter?: string
          class_id?: string | null
          class_label?: string
          concept?: string
          created_at?: string
          id?: string
          image_url?: string | null
          last_activity_at?: string
          school_id?: string | null
          solved_at?: string | null
          solved_by_answer_id?: string | null
          status?: string
          student_id?: string | null
          student_name?: string
          subject?: string
          subject_id?: string | null
          teacher_answered?: boolean
          title?: string
          updated_at?: string
          upvote_count?: number
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "community_doubts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_doubts_solved_by_answer_id_fkey"
            columns: ["solved_by_answer_id"]
            isOneToOne: false
            referencedRelation: "community_doubt_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_doubts_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      community_reputation: {
        Row: {
          accepted_count: number
          answer_count: number
          badges: string[]
          points: number
          school_id: string | null
          top_subject: string | null
          updated_at: string
          upvote_count: number
          user_id: string
        }
        Insert: {
          accepted_count?: number
          answer_count?: number
          badges?: string[]
          points?: number
          school_id?: string | null
          top_subject?: string | null
          updated_at?: string
          upvote_count?: number
          user_id: string
        }
        Update: {
          accepted_count?: number
          answer_count?: number
          badges?: string[]
          points?: number
          school_id?: string | null
          top_subject?: string | null
          updated_at?: string
          upvote_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_reputation_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_mastery: {
        Row: {
          chapter: string | null
          class_level: number | null
          classification: string | null
          concept: string
          confidence_score: number | null
          correct_attempts: number
          forgetting_events_count: number
          half_life_estimate: number
          id: string
          last_attempt_at: string | null
          last_outcome_correct: boolean | null
          mastery_score: number
          mistake_count: number
          recovery_attempts: number
          recovery_correct: number
          school_id: string | null
          student_id: string | null
          subconcept: string | null
          subject: string
          total_attempts: number
          updated_at: string
          user_id: string
        }
        Insert: {
          chapter?: string | null
          class_level?: number | null
          classification?: string | null
          concept: string
          confidence_score?: number | null
          correct_attempts?: number
          forgetting_events_count?: number
          half_life_estimate?: number
          id?: string
          last_attempt_at?: string | null
          last_outcome_correct?: boolean | null
          mastery_score?: number
          mistake_count?: number
          recovery_attempts?: number
          recovery_correct?: number
          school_id?: string | null
          student_id?: string | null
          subconcept?: string | null
          subject: string
          total_attempts?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          chapter?: string | null
          class_level?: number | null
          classification?: string | null
          concept?: string
          confidence_score?: number | null
          correct_attempts?: number
          forgetting_events_count?: number
          half_life_estimate?: number
          id?: string
          last_attempt_at?: string | null
          last_outcome_correct?: boolean | null
          mastery_score?: number
          mistake_count?: number
          recovery_attempts?: number
          recovery_correct?: number
          school_id?: string | null
          student_id?: string | null
          subconcept?: string | null
          subject?: string
          total_attempts?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_mastery_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_mastery_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          platform: string
          school_id: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform: string
          school_id?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          school_id?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      dpp_answers: {
        Row: {
          attempt_id: string
          created_at: string
          id: string
          is_correct: boolean | null
          marks_awarded: number
          question_id: string
          response: Json
          school_id: string | null
          time_ms: number
        }
        Insert: {
          attempt_id: string
          created_at?: string
          id?: string
          is_correct?: boolean | null
          marks_awarded?: number
          question_id: string
          response?: Json
          school_id?: string | null
          time_ms?: number
        }
        Update: {
          attempt_id?: string
          created_at?: string
          id?: string
          is_correct?: boolean | null
          marks_awarded?: number
          question_id?: string
          response?: Json
          school_id?: string | null
          time_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "dpp_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "dpp_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dpp_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "dpp_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dpp_answers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      dpp_attempts: {
        Row: {
          correct_count: number
          dpp_id: string
          id: string
          max_score: number
          school_id: string | null
          score: number
          started_at: string
          status: Database["public"]["Enums"]["dpp_attempt_status"]
          student_id: string
          submitted_at: string | null
          time_spent_sec: number
          total_count: number
          user_id: string
        }
        Insert: {
          correct_count?: number
          dpp_id: string
          id?: string
          max_score?: number
          school_id?: string | null
          score?: number
          started_at?: string
          status?: Database["public"]["Enums"]["dpp_attempt_status"]
          student_id: string
          submitted_at?: string | null
          time_spent_sec?: number
          total_count?: number
          user_id: string
        }
        Update: {
          correct_count?: number
          dpp_id?: string
          id?: string
          max_score?: number
          school_id?: string | null
          score?: number
          started_at?: string
          status?: Database["public"]["Enums"]["dpp_attempt_status"]
          student_id?: string
          submitted_at?: string | null
          time_spent_sec?: number
          total_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dpp_attempts_dpp_id_fkey"
            columns: ["dpp_id"]
            isOneToOne: false
            referencedRelation: "dpps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dpp_attempts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      dpp_questions: {
        Row: {
          chapter: string | null
          class_level: number | null
          concept: string | null
          correct: Json
          created_at: string
          dpp_id: string
          explanation: string | null
          id: string
          kind: Database["public"]["Enums"]["dpp_question_kind"]
          marks: number
          options: Json
          order_index: number
          question: string
          school_id: string | null
          subconcept: string | null
          subject: string | null
        }
        Insert: {
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          correct?: Json
          created_at?: string
          dpp_id: string
          explanation?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["dpp_question_kind"]
          marks?: number
          options?: Json
          order_index?: number
          question: string
          school_id?: string | null
          subconcept?: string | null
          subject?: string | null
        }
        Update: {
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          correct?: Json
          created_at?: string
          dpp_id?: string
          explanation?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["dpp_question_kind"]
          marks?: number
          options?: Json
          order_index?: number
          question?: string
          school_id?: string | null
          subconcept?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dpp_questions_dpp_id_fkey"
            columns: ["dpp_id"]
            isOneToOne: false
            referencedRelation: "dpps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dpp_questions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      dpps: {
        Row: {
          archived_at: string | null
          chapter: string | null
          chapters: string[] | null
          class_id: string
          created_at: string
          created_by: string
          difficulty: string
          due_at: string | null
          duration_sec: number
          id: string
          instructions: string | null
          is_published: boolean
          max_marks: number | null
          negative_marking: number
          passing_marks: number | null
          published_at: string | null
          question_count: number
          scheduled_publish_at: string | null
          school_id: string | null
          status: string
          subject: string
          subject_id: string | null
          test_kind: string
          title: string
          topic: string | null
          topics: string[] | null
          total_marks: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          chapter?: string | null
          chapters?: string[] | null
          class_id: string
          created_at?: string
          created_by: string
          difficulty?: string
          due_at?: string | null
          duration_sec?: number
          id?: string
          instructions?: string | null
          is_published?: boolean
          max_marks?: number | null
          negative_marking?: number
          passing_marks?: number | null
          published_at?: string | null
          question_count?: number
          scheduled_publish_at?: string | null
          school_id?: string | null
          status?: string
          subject: string
          subject_id?: string | null
          test_kind?: string
          title: string
          topic?: string | null
          topics?: string[] | null
          total_marks?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          chapter?: string | null
          chapters?: string[] | null
          class_id?: string
          created_at?: string
          created_by?: string
          difficulty?: string
          due_at?: string | null
          duration_sec?: number
          id?: string
          instructions?: string | null
          is_published?: boolean
          max_marks?: number | null
          negative_marking?: number
          passing_marks?: number | null
          published_at?: string | null
          question_count?: number
          scheduled_publish_at?: string | null
          school_id?: string | null
          status?: string
          subject?: string
          subject_id?: string | null
          test_kind?: string
          title?: string
          topic?: string | null
          topics?: string[] | null
          total_marks?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dpps_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dpps_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          chapters: string[] | null
          class_id: string
          created_at: string
          created_by: string | null
          duration_minutes: number | null
          end_date: string | null
          exam_date: string | null
          exam_group_id: string | null
          exam_type: Database["public"]["Enums"]["exam_type"]
          id: string
          instructions: string | null
          marks_locked: boolean
          max_marks: number
          meta: Json
          name: string
          passing_marks: number | null
          results_published_at: string | null
          scheduled_publish_at: string | null
          school_id: string | null
          start_date: string | null
          status: string
          subject: string
          subject_id: string | null
          topics: string[] | null
        }
        Insert: {
          chapters?: string[] | null
          class_id: string
          created_at?: string
          created_by?: string | null
          duration_minutes?: number | null
          end_date?: string | null
          exam_date?: string | null
          exam_group_id?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          instructions?: string | null
          marks_locked?: boolean
          max_marks?: number
          meta?: Json
          name: string
          passing_marks?: number | null
          results_published_at?: string | null
          scheduled_publish_at?: string | null
          school_id?: string | null
          start_date?: string | null
          status?: string
          subject: string
          subject_id?: string | null
          topics?: string[] | null
        }
        Update: {
          chapters?: string[] | null
          class_id?: string
          created_at?: string
          created_by?: string | null
          duration_minutes?: number | null
          end_date?: string | null
          exam_date?: string | null
          exam_group_id?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          instructions?: string | null
          marks_locked?: boolean
          max_marks?: number
          meta?: Json
          name?: string
          passing_marks?: number | null
          results_published_at?: string | null
          scheduled_publish_at?: string | null
          school_id?: string | null
          start_date?: string | null
          status?: string
          subject?: string
          subject_id?: string | null
          topics?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      fees: {
        Row: {
          amount: number
          created_at: string
          due_date: string | null
          fee_type: string | null
          id: string
          month: string
          notes: string | null
          paid_amount: number
          paid_at: string | null
          receipt_url: string | null
          school_id: string | null
          status: Database["public"]["Enums"]["fee_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          due_date?: string | null
          fee_type?: string | null
          id?: string
          month: string
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          receipt_url?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["fee_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string | null
          fee_type?: string | null
          id?: string
          month?: string
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          receipt_url?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["fee_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fees_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fees_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      homework: {
        Row: {
          archived_at: string | null
          attachment_url: string | null
          attachments: Json | null
          class_id: string
          created_at: string
          created_by: string | null
          description: string | null
          difficulty: string | null
          due_date: string | null
          due_time: string | null
          estimated_minutes: number | null
          external_links: Json | null
          id: string
          instructions: string | null
          max_marks: number | null
          priority: string | null
          published_at: string | null
          scheduled_publish_at: string | null
          school_id: string | null
          status: string
          subject: string
          subject_id: string | null
          tags: string[] | null
          title: string
          updated_at: string
          work_kind: string
        }
        Insert: {
          archived_at?: string | null
          attachment_url?: string | null
          attachments?: Json | null
          class_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          difficulty?: string | null
          due_date?: string | null
          due_time?: string | null
          estimated_minutes?: number | null
          external_links?: Json | null
          id?: string
          instructions?: string | null
          max_marks?: number | null
          priority?: string | null
          published_at?: string | null
          scheduled_publish_at?: string | null
          school_id?: string | null
          status?: string
          subject?: string
          subject_id?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          work_kind?: string
        }
        Update: {
          archived_at?: string | null
          attachment_url?: string | null
          attachments?: Json | null
          class_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          difficulty?: string | null
          due_date?: string | null
          due_time?: string | null
          estimated_minutes?: number | null
          external_links?: Json | null
          id?: string
          instructions?: string | null
          max_marks?: number | null
          priority?: string | null
          published_at?: string | null
          scheduled_publish_at?: string | null
          school_id?: string | null
          status?: string
          subject?: string
          subject_id?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          work_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          attachments: Json | null
          content: string | null
          created_at: string
          external_links: Json | null
          grade: string | null
          graded_at: string | null
          homework_id: string
          id: string
          is_late: boolean | null
          marks_obtained: number | null
          returned_at: string | null
          reviewed_at: string | null
          school_id: string | null
          status: string
          student_id: string
          submitted_at: string | null
          teacher_remarks: string | null
          updated_at: string
          version: number | null
        }
        Insert: {
          attachments?: Json | null
          content?: string | null
          created_at?: string
          external_links?: Json | null
          grade?: string | null
          graded_at?: string | null
          homework_id: string
          id?: string
          is_late?: boolean | null
          marks_obtained?: number | null
          returned_at?: string | null
          reviewed_at?: string | null
          school_id?: string | null
          status?: string
          student_id: string
          submitted_at?: string | null
          teacher_remarks?: string | null
          updated_at?: string
          version?: number | null
        }
        Update: {
          attachments?: Json | null
          content?: string | null
          created_at?: string
          external_links?: Json | null
          grade?: string | null
          graded_at?: string | null
          homework_id?: string
          id?: string
          is_late?: boolean | null
          marks_obtained?: number | null
          returned_at?: string | null
          reviewed_at?: string | null
          school_id?: string | null
          status?: string
          student_id?: string
          submitted_at?: string | null
          teacher_remarks?: string | null
          updated_at?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hw_sub_student_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_resources: {
        Row: {
          class_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_published: boolean
          published_at: string | null
          resource_type: Database["public"]["Enums"]["resource_type"]
          school_id: string
          storage_path: string | null
          subject: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_published?: boolean
          published_at?: string | null
          resource_type?: Database["public"]["Enums"]["resource_type"]
          school_id?: string
          storage_path?: string | null
          subject?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_published?: boolean
          published_at?: string | null
          resource_type?: Database["public"]["Enums"]["resource_type"]
          school_id?: string
          storage_path?: string | null
          subject?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_resources_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_resources_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          applicant_kind: Database["public"]["Enums"]["leave_applicant"]
          applicant_user_id: string
          class_id: string | null
          created_at: string
          from_date: string
          id: string
          leave_type: string
          reason: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          school_id: string | null
          status: Database["public"]["Enums"]["leave_status"]
          student_id: string | null
          to_date: string
          updated_at: string
        }
        Insert: {
          applicant_kind: Database["public"]["Enums"]["leave_applicant"]
          applicant_user_id: string
          class_id?: string | null
          created_at?: string
          from_date: string
          id?: string
          leave_type?: string
          reason?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
          student_id?: string | null
          to_date: string
          updated_at?: string
        }
        Update: {
          applicant_kind?: Database["public"]["Enums"]["leave_applicant"]
          applicant_user_id?: string
          class_id?: string | null
          created_at?: string
          from_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
          student_id?: string | null
          to_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      library_books: {
        Row: {
          author: string
          available_copies: number
          category: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          isbn: string | null
          school_id: string | null
          shelf_location: string | null
          title: string
          total_copies: number
          updated_at: string
        }
        Insert: {
          author?: string
          available_copies?: number
          category?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          isbn?: string | null
          school_id?: string | null
          shelf_location?: string | null
          title: string
          total_copies?: number
          updated_at?: string
        }
        Update: {
          author?: string
          available_copies?: number
          category?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          isbn?: string | null
          school_id?: string | null
          shelf_location?: string | null
          title?: string
          total_copies?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_books_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      library_checkouts: {
        Row: {
          checked_out_at: string
          created_at: string
          due_date: string
          id: string
          issued_by: string | null
          library_books_id: string
          returned_at: string | null
          school_id: string | null
          status: string
          student_id: string
        }
        Insert: {
          checked_out_at?: string
          created_at?: string
          due_date?: string
          id?: string
          issued_by?: string | null
          library_books_id: string
          returned_at?: string | null
          school_id?: string | null
          status?: string
          student_id: string
        }
        Update: {
          checked_out_at?: string
          created_at?: string
          due_date?: string
          id?: string
          issued_by?: string | null
          library_books_id?: string
          returned_at?: string | null
          school_id?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_book_fkey"
            columns: ["library_books_id"]
            isOneToOne: false
            referencedRelation: "library_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_student_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_checkouts_book_id_fkey"
            columns: ["library_books_id"]
            isOneToOne: false
            referencedRelation: "library_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_checkouts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_checkouts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      marks: {
        Row: {
          created_at: string
          exam_id: string
          id: string
          marks_obtained: number
          remarks: string | null
          school_id: string | null
          student_id: string
        }
        Insert: {
          created_at?: string
          exam_id: string
          id?: string
          marks_obtained?: number
          remarks?: string | null
          school_id?: string | null
          student_id: string
        }
        Update: {
          created_at?: string
          exam_id?: string
          id?: string
          marks_obtained?: number
          remarks?: string | null
          school_id?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marks_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marks_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          created_at: string
          id: string
          message_id: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_read_receipts: {
        Row: {
          conversation_id: string | null
          id: string
          message_id: string
          read_at: string
          school_id: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          id?: string
          message_id: string
          read_at?: string
          school_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          id?: string
          message_id?: string
          read_at?: string
          school_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_read_receipts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_read_receipts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_read_receipts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_url: string | null
          content: string
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          has_attachment: boolean
          id: string
          is_read: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          school_id: string | null
          sender_id: string
          subject: string | null
          thread_id: string | null
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_url?: string | null
          content: string
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          has_attachment?: boolean
          id?: string
          is_read?: boolean
          read_at?: string | null
          receiver_id?: string | null
          reply_to_id?: string | null
          school_id?: string | null
          sender_id: string
          subject?: string | null
          thread_id?: string | null
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_url?: string | null
          content?: string
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          has_attachment?: boolean
          id?: string
          is_read?: boolean
          read_at?: string | null
          receiver_id?: string | null
          reply_to_id?: string | null
          school_id?: string | null
          sender_id?: string
          subject?: string | null
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          attachment_url: string | null
          audience: Database["public"]["Enums"]["notice_audience"]
          body: string
          class_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          pinned: boolean
          posted_by: string | null
          priority: Database["public"]["Enums"]["notice_priority"]
          published_at: string | null
          revoked_at: string | null
          school_id: string | null
          status: string
          title: string
        }
        Insert: {
          attachment_url?: string | null
          audience?: Database["public"]["Enums"]["notice_audience"]
          body: string
          class_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          pinned?: boolean
          posted_by?: string | null
          priority?: Database["public"]["Enums"]["notice_priority"]
          published_at?: string | null
          revoked_at?: string | null
          school_id?: string | null
          status?: string
          title: string
        }
        Update: {
          attachment_url?: string | null
          audience?: Database["public"]["Enums"]["notice_audience"]
          body?: string
          class_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          pinned?: boolean
          posted_by?: string | null
          priority?: Database["public"]["Enums"]["notice_priority"]
          published_at?: string | null
          revoked_at?: string | null
          school_id?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          icon: string | null
          id: string
          link: string | null
          read: boolean
          school_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          link?: string | null
          read?: boolean
          school_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          link?: string | null
          read?: boolean
          school_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_academic_alerts: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          parent_user_id: string
          read: boolean
          school_id: string | null
          student_id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          kind: string
          parent_user_id: string
          read?: boolean
          school_id?: string | null
          student_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          parent_user_id?: string
          read?: boolean
          school_id?: string | null
          student_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_academic_alerts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_academic_alerts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_students: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          parent_id: string
          relationship: string
          school_id: string
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          parent_id: string
          relationship?: string
          school_id?: string
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          parent_id?: string
          relationship?: string
          school_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_students_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      parents: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          id: string
          occupation: string | null
          phone: string | null
          photo_url: string | null
          portal_email: string | null
          portal_phone: string | null
          school_id: string
          status: Database["public"]["Enums"]["person_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["gender_type"]
          id?: string
          occupation?: string | null
          phone?: string | null
          photo_url?: string | null
          portal_email?: string | null
          portal_phone?: string | null
          school_id?: string
          status?: Database["public"]["Enums"]["person_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"]
          id?: string
          occupation?: string | null
          phone?: string | null
          photo_url?: string | null
          portal_email?: string | null
          portal_phone?: string | null
          school_id?: string
          status?: Database["public"]["Enums"]["person_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_otps: {
        Row: {
          attempts: number
          code_hash: string
          consumed: boolean
          created_at: string
          expires_at: string
          id: string
          phone: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed?: boolean
          created_at?: string
          expires_at: string
          id?: string
          phone: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
        }
        Relationships: []
      }
      practice_sessions: {
        Row: {
          accuracy: number | null
          analysis_snapshot: Json | null
          board: string | null
          chapter: string | null
          class_level: number | null
          correct_count: number
          created_at: string
          difficulty: string | null
          ended_by_user: boolean | null
          ended_normally: boolean | null
          finished_at: string | null
          id: string
          practice_mode: string | null
          question_count: number
          saved_at: string | null
          school_id: string | null
          score: number
          skipped_count: number
          stream: string | null
          student_id: string | null
          subject: string
          time_limit_sec: number | null
          total_time_ms: number | null
          user_id: string
          wrong_count: number
          xp_earned: number
        }
        Insert: {
          accuracy?: number | null
          analysis_snapshot?: Json | null
          board?: string | null
          chapter?: string | null
          class_level?: number | null
          correct_count?: number
          created_at?: string
          difficulty?: string | null
          ended_by_user?: boolean | null
          ended_normally?: boolean | null
          finished_at?: string | null
          id?: string
          practice_mode?: string | null
          question_count?: number
          saved_at?: string | null
          school_id?: string | null
          score?: number
          skipped_count?: number
          stream?: string | null
          student_id?: string | null
          subject: string
          time_limit_sec?: number | null
          total_time_ms?: number | null
          user_id: string
          wrong_count?: number
          xp_earned?: number
        }
        Update: {
          accuracy?: number | null
          analysis_snapshot?: Json | null
          board?: string | null
          chapter?: string | null
          class_level?: number | null
          correct_count?: number
          created_at?: string
          difficulty?: string | null
          ended_by_user?: boolean | null
          ended_normally?: boolean | null
          finished_at?: string | null
          id?: string
          practice_mode?: string | null
          question_count?: number
          saved_at?: string | null
          school_id?: string | null
          score?: number
          skipped_count?: number
          stream?: string | null
          student_id?: string | null
          subject?: string
          time_limit_sec?: number | null
          total_time_ms?: number | null
          user_id?: string
          wrong_count?: number
          xp_earned?: number
        }
        Relationships: [
          {
            foreignKeyName: "practice_sessions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          photo_url: string | null
          school_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          is_active?: boolean
          phone?: string | null
          photo_url?: string | null
          school_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          photo_url?: string | null
          school_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      progression_achievements: {
        Row: {
          category: string
          code: string
          description: string | null
          hidden: boolean
          label: string
          metric: string | null
          rarity: string
          threshold: number | null
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          description?: string | null
          hidden?: boolean
          label: string
          metric?: string | null
          rarity?: string
          threshold?: number | null
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          description?: string | null
          hidden?: boolean
          label?: string
          metric?: string | null
          rarity?: string
          threshold?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      progression_badge_catalog: {
        Row: {
          category: string
          code: string
          description: string | null
          hidden: boolean
          label: string
          rarity: string
          tier_default: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          description?: string | null
          hidden?: boolean
          label: string
          rarity?: string
          tier_default?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          description?: string | null
          hidden?: boolean
          label?: string
          rarity?: string
          tier_default?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      progression_history: {
        Row: {
          created_at: string
          direction: string
          id: string
          idempotency_key: string | null
          league_after: string | null
          league_before: string | null
          level_after: number
          level_before: number
          meta: Json
          reason: string | null
          reputation_delta: number
          rule_code: string | null
          school_id: string | null
          source_id: string | null
          source_type: string | null
          user_id: string
          xp_after: number
          xp_before: number
          xp_delta: number
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          idempotency_key?: string | null
          league_after?: string | null
          league_before?: string | null
          level_after: number
          level_before: number
          meta?: Json
          reason?: string | null
          reputation_delta?: number
          rule_code?: string | null
          school_id?: string | null
          source_id?: string | null
          source_type?: string | null
          user_id: string
          xp_after: number
          xp_before: number
          xp_delta: number
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          idempotency_key?: string | null
          league_after?: string | null
          league_before?: string | null
          level_after?: number
          level_before?: number
          meta?: Json
          reason?: string | null
          reputation_delta?: number
          rule_code?: string | null
          school_id?: string | null
          source_id?: string | null
          source_type?: string | null
          user_id?: string
          xp_after?: number
          xp_before?: number
          xp_delta?: number
        }
        Relationships: []
      }
      progression_league_history: {
        Row: {
          change_type: string
          created_at: string
          from_league: string | null
          id: string
          school_id: string | null
          to_league: string
          user_id: string
          xp_at_change: number
        }
        Insert: {
          change_type: string
          created_at?: string
          from_league?: string | null
          id?: string
          school_id?: string | null
          to_league: string
          user_id: string
          xp_at_change: number
        }
        Update: {
          change_type?: string
          created_at?: string
          from_league?: string | null
          id?: string
          school_id?: string | null
          to_league?: string
          user_id?: string
          xp_at_change?: number
        }
        Relationships: []
      }
      progression_leagues: {
        Row: {
          code: string
          color_token: string | null
          demote_below_xp: number | null
          label: string
          min_xp: number
          tier: number
          updated_at: string
        }
        Insert: {
          code: string
          color_token?: string | null
          demote_below_xp?: number | null
          label: string
          min_xp: number
          tier: number
          updated_at?: string
        }
        Update: {
          code?: string
          color_token?: string | null
          demote_below_xp?: number | null
          label?: string
          min_xp?: number
          tier?: number
          updated_at?: string
        }
        Relationships: []
      }
      progression_level_config: {
        Row: {
          base_xp: number
          curve: string
          id: number
          updated_at: string
        }
        Insert: {
          base_xp?: number
          curve?: string
          id?: number
          updated_at?: string
        }
        Update: {
          base_xp?: number
          curve?: string
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      progression_xp_rules: {
        Row: {
          amount: number
          category: string
          code: string
          description: string | null
          direction: string
          enabled: boolean
          label: string
          reputation_delta: number
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string
          code: string
          description?: string | null
          direction: string
          enabled?: boolean
          label: string
          reputation_delta?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          code?: string
          description?: string | null
          direction?: string
          enabled?: boolean
          label?: string
          reputation_delta?: number
          updated_at?: string
        }
        Relationships: []
      }
      question_attempts: {
        Row: {
          answered_at: string | null
          attempt_number: number | null
          bank_question_id: string | null
          board: string | null
          chapter: string | null
          class_level: number | null
          concept: string | null
          confidence: number | null
          correct_answer: Json
          created_at: string
          difficulty: string | null
          generated_question: Json
          hint_used: boolean
          id: string
          is_correct: boolean | null
          practice_mode: string | null
          school_id: string | null
          score: number
          selected_answer: Json | null
          session_id: string | null
          skipped: boolean
          solution_viewed: boolean
          source: string | null
          source_id: string | null
          stream: string | null
          student_id: string | null
          subconcept: string | null
          subject: string | null
          template_id: string | null
          time_taken_ms: number | null
          timed_out: boolean
          topic: string | null
          user_id: string
        }
        Insert: {
          answered_at?: string | null
          attempt_number?: number | null
          bank_question_id?: string | null
          board?: string | null
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          confidence?: number | null
          correct_answer: Json
          created_at?: string
          difficulty?: string | null
          generated_question: Json
          hint_used?: boolean
          id?: string
          is_correct?: boolean | null
          practice_mode?: string | null
          school_id?: string | null
          score?: number
          selected_answer?: Json | null
          session_id?: string | null
          skipped?: boolean
          solution_viewed?: boolean
          source?: string | null
          source_id?: string | null
          stream?: string | null
          student_id?: string | null
          subconcept?: string | null
          subject?: string | null
          template_id?: string | null
          time_taken_ms?: number | null
          timed_out?: boolean
          topic?: string | null
          user_id: string
        }
        Update: {
          answered_at?: string | null
          attempt_number?: number | null
          bank_question_id?: string | null
          board?: string | null
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          confidence?: number | null
          correct_answer?: Json
          created_at?: string
          difficulty?: string | null
          generated_question?: Json
          hint_used?: boolean
          id?: string
          is_correct?: boolean | null
          practice_mode?: string | null
          school_id?: string | null
          score?: number
          selected_answer?: Json | null
          session_id?: string | null
          skipped?: boolean
          solution_viewed?: boolean
          source?: string | null
          source_id?: string | null
          stream?: string | null
          student_id?: string | null
          subconcept?: string | null
          subject?: string | null
          template_id?: string | null
          time_taken_ms?: number | null
          timed_out?: boolean
          topic?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_attempts_bank_question_id_fkey"
            columns: ["bank_question_id"]
            isOneToOne: false
            referencedRelation: "question_bank"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_attempts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "question_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      question_bank: {
        Row: {
          board: string | null
          chapter: string | null
          class_level: number | null
          concept: string | null
          correct_index: number
          created_at: string
          created_by: string | null
          difficulty: string
          embed_status: string
          embedding: string | null
          exam_year: number | null
          explanation: string | null
          id: string
          is_active: boolean
          is_approved: boolean
          options: Json
          question: string
          question_format: string | null
          school_id: string | null
          source: string | null
          source_type: string | null
          stream: string | null
          subconcept: string | null
          subject: string
          subtopic: string | null
          topic: string | null
          updated_at: string | null
        }
        Insert: {
          board?: string | null
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          correct_index: number
          created_at?: string
          created_by?: string | null
          difficulty?: string
          embed_status?: string
          embedding?: string | null
          exam_year?: number | null
          explanation?: string | null
          id?: string
          is_active?: boolean
          is_approved?: boolean
          options: Json
          question: string
          question_format?: string | null
          school_id?: string | null
          source?: string | null
          source_type?: string | null
          stream?: string | null
          subconcept?: string | null
          subject: string
          subtopic?: string | null
          topic?: string | null
          updated_at?: string | null
        }
        Update: {
          board?: string | null
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          correct_index?: number
          created_at?: string
          created_by?: string | null
          difficulty?: string
          embed_status?: string
          embedding?: string | null
          exam_year?: number | null
          explanation?: string | null
          id?: string
          is_active?: boolean
          is_approved?: boolean
          options?: Json
          question?: string
          question_format?: string | null
          school_id?: string | null
          source?: string | null
          source_type?: string | null
          stream?: string | null
          subconcept?: string | null
          subject?: string
          subtopic?: string | null
          topic?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "question_bank_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      question_records: {
        Row: {
          attempt_count: number
          bookmarked: boolean
          correct_count: number
          created_at: string
          current_status: string
          id: string
          last_practice_mode: string | null
          last_practiced_date: string
          last_selected_option: Json | null
          last_session_id: string | null
          last_time_taken_ms: number | null
          question_id: string
          question_source: string
          school_id: string | null
          skipped_count: number
          student_id: string | null
          updated_at: string
          user_id: string
          wrong_count: number
        }
        Insert: {
          attempt_count?: number
          bookmarked?: boolean
          correct_count?: number
          created_at?: string
          current_status: string
          id?: string
          last_practice_mode?: string | null
          last_practiced_date?: string
          last_selected_option?: Json | null
          last_session_id?: string | null
          last_time_taken_ms?: number | null
          question_id: string
          question_source?: string
          school_id?: string | null
          skipped_count?: number
          student_id?: string | null
          updated_at?: string
          user_id: string
          wrong_count?: number
        }
        Update: {
          attempt_count?: number
          bookmarked?: boolean
          correct_count?: number
          created_at?: string
          current_status?: string
          id?: string
          last_practice_mode?: string | null
          last_practiced_date?: string
          last_selected_option?: Json | null
          last_session_id?: string | null
          last_time_taken_ms?: number | null
          question_id?: string
          question_source?: string
          school_id?: string | null
          skipped_count?: number
          student_id?: string | null
          updated_at?: string
          user_id?: string
          wrong_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_records_last_session_id_fkey"
            columns: ["last_session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_records_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "question_bank"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      question_templates: {
        Row: {
          chapter: string
          class: number
          concept: string | null
          created_at: string
          difficulty: string | null
          explanation_template: string
          id: string
          is_active: boolean
          school_id: string | null
          subconcept: string | null
          subject: string
          template_data: Json
          template_type: string
        }
        Insert: {
          chapter: string
          class: number
          concept?: string | null
          created_at?: string
          difficulty?: string | null
          explanation_template?: string
          id?: string
          is_active?: boolean
          school_id?: string | null
          subconcept?: string | null
          subject: string
          template_data?: Json
          template_type: string
        }
        Update: {
          chapter?: string
          class?: number
          concept?: string | null
          created_at?: string
          difficulty?: string | null
          explanation_template?: string
          id?: string
          is_active?: boolean
          school_id?: string | null
          subconcept?: string | null
          subject?: string
          template_data?: Json
          template_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_templates_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      recovery_assignment_questions: {
        Row: {
          answered: boolean
          assignment_id: string
          bank_question_id: string | null
          correct_answer: Json
          created_at: string
          explanation: string | null
          id: string
          is_correct: boolean | null
          options: Json
          order_index: number
          question_text: string
          school_id: string | null
          student_answer: Json | null
          template_id: string | null
        }
        Insert: {
          answered?: boolean
          assignment_id: string
          bank_question_id?: string | null
          correct_answer?: Json
          created_at?: string
          explanation?: string | null
          id?: string
          is_correct?: boolean | null
          options?: Json
          order_index?: number
          question_text: string
          school_id?: string | null
          student_answer?: Json | null
          template_id?: string | null
        }
        Update: {
          answered?: boolean
          assignment_id?: string
          bank_question_id?: string | null
          correct_answer?: Json
          created_at?: string
          explanation?: string | null
          id?: string
          is_correct?: boolean | null
          options?: Json
          order_index?: number
          question_text?: string
          school_id?: string | null
          student_answer?: Json | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recovery_assignment_questions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "recovery_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_assignment_questions_bank_question_id_fkey"
            columns: ["bank_question_id"]
            isOneToOne: false
            referencedRelation: "question_bank"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_assignment_questions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_assignment_questions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "question_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      recovery_assignments: {
        Row: {
          chapter: string | null
          completed_at: string | null
          concept: string
          created_at: string
          id: string
          question_count: number
          questions_completed: number
          questions_correct: number
          school_id: string | null
          severity: string
          source_id: string | null
          source_type: string | null
          status: string
          student_id: string | null
          subconcept: string | null
          subject: string
          user_id: string
        }
        Insert: {
          chapter?: string | null
          completed_at?: string | null
          concept: string
          created_at?: string
          id?: string
          question_count?: number
          questions_completed?: number
          questions_correct?: number
          school_id?: string | null
          severity: string
          source_id?: string | null
          source_type?: string | null
          status?: string
          student_id?: string | null
          subconcept?: string | null
          subject: string
          user_id: string
        }
        Update: {
          chapter?: string | null
          completed_at?: string | null
          concept?: string
          created_at?: string
          id?: string
          question_count?: number
          questions_completed?: number
          questions_correct?: number
          school_id?: string | null
          severity?: string
          source_id?: string | null
          source_type?: string | null
          status?: string
          student_id?: string | null
          subconcept?: string | null
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_assignments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      revision_queue: {
        Row: {
          chapter: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          due_date: string
          id: string
          priority: number
          reason: string
          school_id: string | null
          student_id: string | null
          subject: string
          topic: string | null
          user_id: string
        }
        Insert: {
          chapter?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          due_date?: string
          id?: string
          priority?: number
          reason?: string
          school_id?: string | null
          student_id?: string | null
          subject: string
          topic?: string | null
          user_id: string
        }
        Update: {
          chapter?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          due_date?: string
          id?: string
          priority?: number
          reason?: string
          school_id?: string | null
          student_id?: string | null
          subject?: string
          topic?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revision_queue_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revision_queue_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      school_activity_feed: {
        Row: {
          action: string
          actor_name: string | null
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
          school_id: string
        }
        Insert: {
          action: string
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          school_id?: string
        }
        Update: {
          action?: string
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_activity_feed_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_calendar_events: {
        Row: {
          all_day: boolean
          audience: Database["public"]["Enums"]["notice_audience"]
          class_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          event_type: Database["public"]["Enums"]["calendar_event_type"]
          id: string
          school_id: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          audience?: Database["public"]["Enums"]["notice_audience"]
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          event_type?: Database["public"]["Enums"]["calendar_event_type"]
          id?: string
          school_id?: string
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          audience?: Database["public"]["Enums"]["notice_audience"]
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          event_type?: Database["public"]["Enums"]["calendar_event_type"]
          id?: string
          school_id?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_calendar_events_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_calendar_events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_complaints: {
        Row: {
          body: string
          category: string
          complainant_name: string
          created_at: string
          id: string
          resolution_notes: string | null
          school_id: string | null
          status: Database["public"]["Enums"]["case_status"]
          student_id: string | null
          subject: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          body: string
          category?: string
          complainant_name?: string
          created_at?: string
          id?: string
          resolution_notes?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          student_id?: string | null
          subject: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          complainant_name?: string
          created_at?: string
          id?: string
          resolution_notes?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          student_id?: string | null
          subject?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_complaints_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_complaints_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      school_inquiries: {
        Row: {
          contact_email: string | null
          contact_name: string
          contact_phone: string | null
          created_at: string
          created_by: string | null
          grade_interest: string | null
          id: string
          message: string
          notes: string | null
          school_id: string | null
          status: Database["public"]["Enums"]["case_status"]
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          grade_interest?: string | null
          id?: string
          message: string
          notes?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          grade_interest?: string | null
          id?: string
          message?: string
          notes?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_inquiries_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          academic_year: string | null
          address: string | null
          board: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          phone: string | null
          principal_name: string | null
          slug: string | null
          stream: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          academic_year?: string | null
          address?: string | null
          board?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          phone?: string | null
          principal_name?: string | null
          slug?: string | null
          stream?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          academic_year?: string | null
          address?: string | null
          board?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          phone?: string | null
          principal_name?: string | null
          slug?: string | null
          stream?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      staff_attendance: {
        Row: {
          created_at: string
          date: string
          id: string
          marked_by: string | null
          school_id: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          teacher_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
          school_id?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          teacher_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      student_academic_brain: {
        Row: {
          accuracy_trend: Json
          consistency_trend: Json
          id: string
          improvement_history: Json
          improvement_trend: string
          last_session_analytics: Json
          mastery_snapshot: Json
          mistake_classification_trends: Json
          mistake_history: Json
          practice_history: Json
          recovery_completion_pct: number
          recovery_history: Json
          school_id: string | null
          speed_trend: Json
          strong_chapters: Json
          strong_concepts: Json
          strong_subjects: Json
          student_id: string | null
          total_activities: number
          updated_at: string
          user_id: string
          weak_chapters: Json
          weak_concepts: Json
          weak_subjects: Json
        }
        Insert: {
          accuracy_trend?: Json
          consistency_trend?: Json
          id?: string
          improvement_history?: Json
          improvement_trend?: string
          last_session_analytics?: Json
          mastery_snapshot?: Json
          mistake_classification_trends?: Json
          mistake_history?: Json
          practice_history?: Json
          recovery_completion_pct?: number
          recovery_history?: Json
          school_id?: string | null
          speed_trend?: Json
          strong_chapters?: Json
          strong_concepts?: Json
          strong_subjects?: Json
          student_id?: string | null
          total_activities?: number
          updated_at?: string
          user_id: string
          weak_chapters?: Json
          weak_concepts?: Json
          weak_subjects?: Json
        }
        Update: {
          accuracy_trend?: Json
          consistency_trend?: Json
          id?: string
          improvement_history?: Json
          improvement_trend?: string
          last_session_analytics?: Json
          mastery_snapshot?: Json
          mistake_classification_trends?: Json
          mistake_history?: Json
          practice_history?: Json
          recovery_completion_pct?: number
          recovery_history?: Json
          school_id?: string | null
          speed_trend?: Json
          strong_chapters?: Json
          strong_concepts?: Json
          strong_subjects?: Json
          student_id?: string | null
          total_activities?: number
          updated_at?: string
          user_id?: string
          weak_chapters?: Json
          weak_concepts?: Json
          weak_subjects?: Json
        }
        Relationships: [
          {
            foreignKeyName: "student_academic_brain_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_academic_brain_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_academic_profiles: {
        Row: {
          academic_year_id: string | null
          attendance_pct: number
          attendance_present: number
          attendance_risk_band: string
          attendance_total: number
          created_at: string
          doubts_asked: number
          doubts_resolved: number
          exams_avg_pct: number
          exams_recorded: number
          homework_assigned: number
          homework_completion_pct: number
          homework_consistency_band: string
          homework_submitted: number
          id: string
          last_event_at: string | null
          last_event_type: string | null
          metrics: Json
          practice_accuracy_pct: number
          practice_sessions: number
          refreshed_at: string
          remarks_count: number
          school_id: string
          student_id: string
          tests_attempted: number
          tests_avg_pct: number
          updated_at: string
        }
        Insert: {
          academic_year_id?: string | null
          attendance_pct?: number
          attendance_present?: number
          attendance_risk_band?: string
          attendance_total?: number
          created_at?: string
          doubts_asked?: number
          doubts_resolved?: number
          exams_avg_pct?: number
          exams_recorded?: number
          homework_assigned?: number
          homework_completion_pct?: number
          homework_consistency_band?: string
          homework_submitted?: number
          id?: string
          last_event_at?: string | null
          last_event_type?: string | null
          metrics?: Json
          practice_accuracy_pct?: number
          practice_sessions?: number
          refreshed_at?: string
          remarks_count?: number
          school_id?: string
          student_id: string
          tests_attempted?: number
          tests_avg_pct?: number
          updated_at?: string
        }
        Update: {
          academic_year_id?: string | null
          attendance_pct?: number
          attendance_present?: number
          attendance_risk_band?: string
          attendance_total?: number
          created_at?: string
          doubts_asked?: number
          doubts_resolved?: number
          exams_avg_pct?: number
          exams_recorded?: number
          homework_assigned?: number
          homework_completion_pct?: number
          homework_consistency_band?: string
          homework_submitted?: number
          id?: string
          last_event_at?: string | null
          last_event_type?: string | null
          metrics?: Json
          practice_accuracy_pct?: number
          practice_sessions?: number
          refreshed_at?: string
          remarks_count?: number
          school_id?: string
          student_id?: string
          tests_attempted?: number
          tests_avg_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_academic_profiles_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_academic_profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_academic_profiles_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_achievements: {
        Row: {
          achievement_code: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_code: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_code?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_achievements_achievement_code_fkey"
            columns: ["achievement_code"]
            isOneToOne: false
            referencedRelation: "progression_achievements"
            referencedColumns: ["code"]
          },
        ]
      }
      student_badges: {
        Row: {
          badge_code: string
          earned_at: string
          id: string
          school_id: string | null
          tier: Database["public"]["Enums"]["badge_tier"]
          user_id: string
        }
        Insert: {
          badge_code: string
          earned_at?: string
          id?: string
          school_id?: string | null
          tier?: Database["public"]["Enums"]["badge_tier"]
          user_id: string
        }
        Update: {
          badge_code?: string
          earned_at?: string
          id?: string
          school_id?: string | null
          tier?: Database["public"]["Enums"]["badge_tier"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_badges_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      student_improvement_plans: {
        Row: {
          chapter: string | null
          id: string
          plan: Json
          school_id: string | null
          source: string
          subject: string
          topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chapter?: string | null
          id?: string
          plan?: Json
          school_id?: string | null
          source: string
          subject: string
          topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chapter?: string | null
          id?: string
          plan?: Json
          school_id?: string | null
          source?: string
          subject?: string
          topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_improvement_plans_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      student_mistakes: {
        Row: {
          assessment_type: string | null
          chapter: string | null
          class_level: number | null
          concept: string | null
          correct_answer: Json | null
          created_at: string
          difficulty: string | null
          error_type: string | null
          explanation: string | null
          id: string
          last_wrong_at: string
          mastered: boolean
          options: Json | null
          question_id: string | null
          question_text: string
          school_id: string | null
          source: string
          source_id: string | null
          student_answer: Json | null
          student_id: string | null
          subconcept: string | null
          subject: string
          times_wrong: number
          topic: string | null
          user_id: string
        }
        Insert: {
          assessment_type?: string | null
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          correct_answer?: Json | null
          created_at?: string
          difficulty?: string | null
          error_type?: string | null
          explanation?: string | null
          id?: string
          last_wrong_at?: string
          mastered?: boolean
          options?: Json | null
          question_id?: string | null
          question_text: string
          school_id?: string | null
          source: string
          source_id?: string | null
          student_answer?: Json | null
          student_id?: string | null
          subconcept?: string | null
          subject?: string
          times_wrong?: number
          topic?: string | null
          user_id: string
        }
        Update: {
          assessment_type?: string | null
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          correct_answer?: Json | null
          created_at?: string
          difficulty?: string | null
          error_type?: string | null
          explanation?: string | null
          id?: string
          last_wrong_at?: string
          mastered?: boolean
          options?: Json | null
          question_id?: string | null
          question_text?: string
          school_id?: string | null
          source?: string
          source_id?: string | null
          student_answer?: Json | null
          student_id?: string | null
          subconcept?: string | null
          subject?: string
          times_wrong?: number
          topic?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_mistakes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_mistakes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_question_history: {
        Row: {
          last_seen_at: string
          question_id: string
          school_id: string | null
          times_seen: number
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          question_id: string
          school_id?: string | null
          times_seen?: number
          user_id: string
        }
        Update: {
          last_seen_at?: string
          question_id?: string
          school_id?: string | null
          times_seen?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_question_history_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "question_bank"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_question_history_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      student_xp: {
        Row: {
          ai_sessions_count: number
          best_score: number
          best_win_streak: number
          current_streak: number
          demotion_warning_at: string | null
          equipped_badge: string | null
          featured_badges: string[]
          highest_league_code: string | null
          homework_submitted_count: number
          last_activity_at: string | null
          last_battle_at: string | null
          last_study_date: string | null
          league_code: string | null
          level: number
          longest_streak: number
          practice_sessions_count: number
          reputation: number
          school_id: string | null
          streak_protection_tokens: number
          study_longest_streak: number
          study_month_streak: number
          study_streak: number
          study_week_streak: number
          total_answered: number
          total_battles: number
          total_correct: number
          updated_at: string
          user_id: string
          win_streak: number
          wins: number
          xp: number
        }
        Insert: {
          ai_sessions_count?: number
          best_score?: number
          best_win_streak?: number
          current_streak?: number
          demotion_warning_at?: string | null
          equipped_badge?: string | null
          featured_badges?: string[]
          highest_league_code?: string | null
          homework_submitted_count?: number
          last_activity_at?: string | null
          last_battle_at?: string | null
          last_study_date?: string | null
          league_code?: string | null
          level?: number
          longest_streak?: number
          practice_sessions_count?: number
          reputation?: number
          school_id?: string | null
          streak_protection_tokens?: number
          study_longest_streak?: number
          study_month_streak?: number
          study_streak?: number
          study_week_streak?: number
          total_answered?: number
          total_battles?: number
          total_correct?: number
          updated_at?: string
          user_id: string
          win_streak?: number
          wins?: number
          xp?: number
        }
        Update: {
          ai_sessions_count?: number
          best_score?: number
          best_win_streak?: number
          current_streak?: number
          demotion_warning_at?: string | null
          equipped_badge?: string | null
          featured_badges?: string[]
          highest_league_code?: string | null
          homework_submitted_count?: number
          last_activity_at?: string | null
          last_battle_at?: string | null
          last_study_date?: string | null
          league_code?: string | null
          level?: number
          longest_streak?: number
          practice_sessions_count?: number
          reputation?: number
          school_id?: string | null
          streak_protection_tokens?: number
          study_longest_streak?: number
          study_month_streak?: number
          study_streak?: number
          study_week_streak?: number
          total_answered?: number
          total_battles?: number
          total_correct?: number
          updated_at?: string
          user_id?: string
          win_streak?: number
          wins?: number
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_xp_highest_league_code_fkey"
            columns: ["highest_league_code"]
            isOneToOne: false
            referencedRelation: "progression_leagues"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "student_xp_league_code_fkey"
            columns: ["league_code"]
            isOneToOne: false
            referencedRelation: "progression_leagues"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "student_xp_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          address: string | null
          admission_number: string
          blood_group: string | null
          class_id: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          emergency_contact: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          house: string | null
          id: string
          medical_notes: string | null
          parent_mobile: string | null
          parent_name: string | null
          parent_portal_email: string | null
          parent_user_id: string | null
          phone: string | null
          photo_url: string | null
          portal_email: string | null
          portal_phone: string | null
          roll_number: string | null
          school_id: string | null
          status: Database["public"]["Enums"]["person_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          admission_number: string
          blood_group?: string | null
          class_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          emergency_contact?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["gender_type"]
          house?: string | null
          id?: string
          medical_notes?: string | null
          parent_mobile?: string | null
          parent_name?: string | null
          parent_portal_email?: string | null
          parent_user_id?: string | null
          phone?: string | null
          photo_url?: string | null
          portal_email?: string | null
          portal_phone?: string | null
          roll_number?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["person_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          admission_number?: string
          blood_group?: string | null
          class_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          emergency_contact?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"]
          house?: string | null
          id?: string
          medical_notes?: string | null
          parent_mobile?: string | null
          parent_name?: string | null
          parent_portal_email?: string | null
          parent_user_id?: string | null
          phone?: string | null
          photo_url?: string | null
          portal_email?: string | null
          portal_phone?: string | null
          roll_number?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["person_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          school_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          school_id?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_classes: {
        Row: {
          class_id: string
          id: string
          school_id: string | null
          subject: string | null
          subject_id: string | null
          teacher_id: string
        }
        Insert: {
          class_id: string
          id?: string
          school_id?: string | null
          subject?: string | null
          subject_id?: string | null
          teacher_id: string
        }
        Update: {
          class_id?: string
          id?: string
          school_id?: string | null
          subject?: string | null
          subject_id?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_classes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_classes_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_classes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_remarks: {
        Row: {
          academic_year_id: string | null
          body: string
          class_id: string | null
          created_at: string
          created_by: string | null
          id: string
          remark_type: string
          school_id: string
          student_id: string
          subject_id: string | null
          teacher_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          academic_year_id?: string | null
          body: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          remark_type?: string
          school_id?: string
          student_id: string
          subject_id?: string | null
          teacher_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          academic_year_id?: string | null
          body?: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          remark_type?: string
          school_id?: string
          student_id?: string
          subject_id?: string | null
          teacher_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_remarks_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_remarks_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_remarks_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_remarks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_remarks_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_remarks_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          address: string | null
          class_teacher_of: string | null
          created_at: string
          date_of_birth: string | null
          department: string | null
          email: string | null
          employee_id: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          id: string
          is_class_teacher: boolean
          joined_date: string | null
          joining_date: string | null
          mobile: string | null
          notes: string | null
          photo_url: string | null
          qualification: string | null
          salary: number | null
          school_id: string | null
          status: string
          subject: string | null
          subjects: string[]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          class_teacher_of?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          email?: string | null
          employee_id?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["gender_type"]
          id?: string
          is_class_teacher?: boolean
          joined_date?: string | null
          joining_date?: string | null
          mobile?: string | null
          notes?: string | null
          photo_url?: string | null
          qualification?: string | null
          salary?: number | null
          school_id?: string | null
          status?: string
          subject?: string | null
          subjects?: string[]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          class_teacher_of?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"]
          id?: string
          is_class_teacher?: boolean
          joined_date?: string | null
          joining_date?: string | null
          mobile?: string | null
          notes?: string | null
          photo_url?: string | null
          qualification?: string | null
          salary?: number | null
          school_id?: string | null
          status?: string
          subject?: string | null
          subjects?: string[]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teachers_class_teacher_of_fkey"
            columns: ["class_teacher_of"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_slots: {
        Row: {
          class_id: string
          day_of_week: number
          ends_at: string | null
          id: string
          period_number: number
          room: string | null
          school_id: string
          starts_at: string | null
          subject: string
          subject_id: string | null
          teacher_id: string | null
        }
        Insert: {
          class_id: string
          day_of_week: number
          ends_at?: string | null
          id?: string
          period_number: number
          room?: string | null
          school_id?: string
          starts_at?: string | null
          subject: string
          subject_id?: string | null
          teacher_id?: string | null
        }
        Update: {
          class_id?: string
          day_of_week?: number
          ends_at?: string | null
          id?: string
          period_number?: number
          room?: string | null
          school_id?: string
          starts_at?: string | null
          subject?: string
          subject_id?: string | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timetable_slots_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slots_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slots_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slots_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _academic_label_match_key: { Args: { t: string }; Returns: string }
      _award_achievement: {
        Args: { _code: string; _uid: string }
        Returns: undefined
      }
      _award_badge: {
        Args: {
          _code: string
          _tier?: Database["public"]["Enums"]["badge_tier"]
          _uid: string
        }
        Returns: undefined
      }
      _award_engagement_badges: { Args: { _uid: string }; Returns: undefined }
      _backfill_battle_question_concepts: { Args: never; Returns: number }
      _backfill_dpp_question_concepts: { Args: never; Returns: number }
      _backfill_question_bank_concepts: { Args: never; Returns: number }
      _backfill_template_concepts: { Args: never; Returns: number }
      _battle_event: {
        Args: {
          _battle?: string
          _class?: string
          _detail: string
          _icon?: string
          _kind: string
          _name: string
          _opponent?: string
          _subject?: string
          _uid: string
        }
        Returns: undefined
      }
      _build_concept_recovery_report: {
        Args: { _source_id: string; _source_type: string; _uid: string }
        Returns: Json
      }
      _bump_academic_activity:
        | {
            Args: {
              _battle?: number
              _dpp?: number
              _hw?: number
              _mins?: number
              _uid: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _battle?: number
              _dpp?: number
              _hw?: number
              _mins?: number
              _self_practice?: number
              _uid: string
            }
            Returns: undefined
          }
      _capture_battle_mistakes: {
        Args: { _participant_id: string }
        Returns: undefined
      }
      _capture_dpp_mistakes: {
        Args: { _attempt_id: string }
        Returns: undefined
      }
      _class_grade: { Args: { _class_id: string }; Returns: number }
      _classify_mistake_error: {
        Args: {
          _correct_answer: Json
          _options: Json
          _student_answer: Json
          _time_taken_ms?: number
          _times_wrong?: number
        }
        Returns: string
      }
      _community_author_name: {
        Args: { _role: string; _uid: string }
        Returns: string
      }
      _community_refresh_reputation: {
        Args: { _uid: string }
        Returns: undefined
      }
      _community_user_role: { Args: { _uid: string }; Returns: string }
      _compute_mastery_score: {
        Args: {
          _attempts: number
          _correct: number
          _last_at: string
          _mistakes: number
          _recovery_attempts: number
          _recovery_correct: number
        }
        Returns: number
      }
      _concept_severity: { Args: { _accuracy: number }; Returns: string }
      _demo_upsert_auth_user: {
        Args: {
          _email: string
          _full_name: string
          _id: string
          _password: string
        }
        Returns: undefined
      }
      _dim_consistency: {
        Args: {
          _chapter: string
          _concept: string
          _subconcept: string
          _subject: string
          _user_id: string
        }
        Returns: number
      }
      _dim_evidence_strength: {
        Args: {
          _chapter: string
          _concept: string
          _subconcept: string
          _subject: string
          _user_id: string
        }
        Returns: number
      }
      _dim_growth_trend: {
        Args: {
          _chapter: string
          _concept: string
          _subconcept: string
          _subject: string
          _user_id: string
        }
        Returns: number
      }
      _dim_recovery_need: {
        Args: {
          _chapter: string
          _concept: string
          _subconcept: string
          _subject: string
          _user_id: string
        }
        Returns: number
      }
      _dim_retention: {
        Args: {
          _chapter: string
          _concept: string
          _subconcept: string
          _subject: string
          _user_id: string
        }
        Returns: number
      }
      _dim_understanding: {
        Args: {
          _chapter: string
          _concept: string
          _subconcept: string
          _subject: string
          _user_id: string
        }
        Returns: number
      }
      _eie_attendance_risk_band: { Args: { _pct: number }; Returns: string }
      _eie_band_severity: { Args: { _band: string }; Returns: number }
      _eie_homework_consistency_band: {
        Args: { _pct: number }
        Returns: string
      }
      _ensure_student_xp: {
        Args: { _uid: string }
        Returns: {
          ai_sessions_count: number
          best_score: number
          best_win_streak: number
          current_streak: number
          demotion_warning_at: string | null
          equipped_badge: string | null
          featured_badges: string[]
          highest_league_code: string | null
          homework_submitted_count: number
          last_activity_at: string | null
          last_battle_at: string | null
          last_study_date: string | null
          league_code: string | null
          level: number
          longest_streak: number
          practice_sessions_count: number
          reputation: number
          school_id: string | null
          streak_protection_tokens: number
          study_longest_streak: number
          study_month_streak: number
          study_streak: number
          study_week_streak: number
          total_answered: number
          total_battles: number
          total_correct: number
          updated_at: string
          user_id: string
          win_streak: number
          wins: number
          xp: number
        }
        SetofOptions: {
          from: "*"
          to: "student_xp"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _exam_readiness: {
        Args: { _student_id: string; _uid: string }
        Returns: Json
      }
      _fanout_announcement_published: {
        Args: {
          _body?: string
          _class_id: string
          _school_id: string
          _title: string
        }
        Returns: undefined
      }
      _featured_system_creator: { Args: { _class_id: string }; Returns: string }
      _fill_featured_battle_questions: {
        Args: { _battle_id: string; _count?: number }
        Returns: number
      }
      _fix_academic_display_text: { Args: { t: string }; Returns: string }
      _fix_utf8_content: { Args: { t: string }; Returns: string }
      _generate_battle_code: { Args: never; Returns: string }
      _humanize_template_type: { Args: { _t: string }; Returns: string }
      _maybe_finish_battle: { Args: { _battle_id: string }; Returns: undefined }
      _normalize_cp1252_mojibake_to_latin1: {
        Args: { t: string }
        Returns: string
      }
      _normalize_subject_label: { Args: { raw: string }; Returns: string }
      _notify: {
        Args: {
          _body?: string
          _icon?: string
          _link?: string
          _title: string
          _type: string
          _uid: string
        }
        Returns: undefined
      }
      _notify_class_students: {
        Args: {
          _body?: string
          _class_id: string
          _icon?: string
          _link?: string
          _title: string
          _type: string
        }
        Returns: undefined
      }
      _notify_class_teacher: {
        Args: {
          _body?: string
          _class_id: string
          _icon?: string
          _link?: string
          _title: string
          _type: string
        }
        Returns: undefined
      }
      _notify_school_operators: {
        Args: {
          _body?: string
          _icon?: string
          _link?: string
          _school_id: string
          _title: string
          _type: string
        }
        Returns: undefined
      }
      _notify_school_students: {
        Args: {
          _body?: string
          _icon?: string
          _link?: string
          _school_id: string
          _title: string
          _type: string
        }
        Returns: undefined
      }
      _notify_student_circle: {
        Args: {
          _body?: string
          _icon?: string
          _link?: string
          _student_id: string
          _title: string
          _type: string
        }
        Returns: undefined
      }
      _notify_student_parents: {
        Args: {
          _body?: string
          _icon?: string
          _link?: string
          _student_id: string
          _title: string
          _type: string
        }
        Returns: undefined
      }
      _peek_teacher_featured_battle: {
        Args: { _class_id: string }
        Returns: string
      }
      _pick_featured_subject: {
        Args: { _class_id: string; _grade: number }
        Returns: string
      }
      _practice_grade_from_bank: {
        Args: {
          _bank_question_id: string
          _client_correct_answer?: Json
          _selected_answer: Json
        }
        Returns: {
          chapter: string
          class_level: number
          concept: string
          correct_answer: Json
          difficulty: string
          explanation: string
          is_correct: boolean
          options: Json
          question_text: string
          score: number
          subconcept: string
          subject: string
        }[]
      }
      _progression_bump_study_streak: {
        Args: { _on?: string; _uid: string }
        Returns: undefined
      }
      _progression_check_milestones: {
        Args: { _uid: string }
        Returns: undefined
      }
      _rebuild_revision_queue: {
        Args: { _student_id: string; _uid: string }
        Returns: undefined
      }
      _recompute_concept_confidence_for_session: {
        Args: { _session_id: string }
        Returns: undefined
      }
      _recovery_question_count: { Args: { _severity: string }; Returns: number }
      _repair_utf8_mojibake: { Args: { t: string }; Returns: string }
      _revision_recently_completed: {
        Args: {
          _chapter: string
          _days?: number
          _subject: string
          _topic: string
          _uid: string
        }
        Returns: boolean
      }
      _revision_topic_priority: {
        Args: {
          _accuracy?: number
          _chapter: string
          _subject: string
          _topic: string
          _uid: string
        }
        Returns: {
          priority: number
          sort_factors: string[]
        }[]
      }
      _rule_improvement_plan: {
        Args: {
          _accuracy: number
          _attempts: number
          _chapter: string
          _mistakes: number
          _subject: string
          _topic: string
        }
        Returns: Json
      }
      _seed_featured_battle_for_class: {
        Args: { _class_id: string; _kind: string }
        Returns: string
      }
      _snapshot_battle_report: {
        Args: { _participant_id: string }
        Returns: string
      }
      _upsert_concept_mastery: {
        Args: {
          _chapter: string
          _class: number
          _concept: string
          _is_correct: boolean
          _is_recovery?: boolean
          _sid: string
          _subconcept: string
          _subject: string
          _uid: string
        }
        Returns: undefined
      }
      _upsert_question_record: {
        Args: {
          _practice_mode?: string
          _question_id: string
          _school: string
          _selected_option?: Json
          _session_id?: string
          _sid: string
          _source?: string
          _status: string
          _time_taken_ms?: number
          _uid: string
        }
        Returns: undefined
      }
      _weak_topics_for_user: {
        Args: { _uid: string }
        Returns: {
          accuracy: number
          attempts: number
          chapter: string
          correct: number
          subject: string
          topic: string
        }[]
      }
      admin_assign_role: {
        Args: {
          _identifier: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      admin_connect_student_account: {
        Args: { _as?: string; _identifier: string; _student_id: string }
        Returns: string
      }
      admin_connect_teacher_account: {
        Args: { _identifier: string; _teacher_id: string }
        Returns: string
      }
      admin_link_user_to_student: {
        Args: { _as: string; _email: string; _student_id: string }
        Returns: undefined
      }
      admin_link_user_to_teacher: {
        Args: { _email: string; _teacher_id: string }
        Returns: undefined
      }
      admin_list_users_with_roles: {
        Args: never
        Returns: {
          created_at: string
          email: string
          phone: string
          roles: Database["public"]["Enums"]["app_role"][]
          user_id: string
        }[]
      }
      admin_remove_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_revoke_student_account: {
        Args: { _student_id: string }
        Returns: undefined
      }
      admin_revoke_teacher_account: {
        Args: { _teacher_id: string }
        Returns: undefined
      }
      admin_set_teacher_access: {
        Args: { _active: boolean; _teacher_id: string }
        Returns: undefined
      }
      admin_set_unique_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      ai_analytics_summary_v1: {
        Args: { p_from: string; p_school_id: string; p_to: string }
        Returns: Json
      }
      ai_benchmark_gate_passed: {
        Args: { p_candidate_label: string; p_suite_ids?: string[] }
        Returns: Json
      }
      ai_budget_check_and_reserve: {
        Args: { p_feature_id: string; p_school_id: string; p_units?: number }
        Returns: Json
      }
      ai_cosine_similarity: {
        Args: { a: number[]; b: number[] }
        Returns: number
      }
      ai_embedding_jobs_process_batch: {
        Args: { p_limit?: number; p_provider_configured?: boolean }
        Returns: Json
      }
      ai_kms_approve_version: {
        Args: { p_document_id: string; p_publish?: boolean; p_version: number }
        Returns: Json
      }
      ai_kms_assert_staff: { Args: never; Returns: string }
      ai_kms_complete_chunk_embed: {
        Args: {
          p_chunk_id: string
          p_embedding?: number[]
          p_error?: string
          p_failed?: boolean
          p_model_version?: string
        }
        Returns: Json
      }
      ai_kms_defer_unset_embeddings: {
        Args: { p_limit?: number }
        Returns: Json
      }
      ai_kms_enqueue_embedding_jobs: {
        Args: { p_document_id: string; p_version?: number }
        Returns: Json
      }
      ai_kms_register_document: {
        Args: {
          p_content_type?: string
          p_metadata?: Json
          p_school_id: string
          p_title: string
          p_visibility?: string[]
        }
        Returns: Json
      }
      ai_kms_reject_version: {
        Args: { p_document_id: string; p_reason?: string; p_version: number }
        Returns: Json
      }
      ai_kms_retrieve_chunks: {
        Args: {
          p_grade?: string
          p_limit?: number
          p_min_score?: number
          p_query: string
          p_query_embedding?: number[]
          p_role?: string
          p_school_id: string
          p_subject?: string
        }
        Returns: Json
      }
      ai_kms_submit_version: {
        Args: {
          p_chunk_texts?: string[]
          p_document_id: string
          p_raw_text: string
          p_source_uri?: string
        }
        Returns: Json
      }
      ai_lexical_overlap: {
        Args: { body: string; query: string }
        Returns: number
      }
      ai_prompt_load_production: {
        Args: { p_capability_id: string }
        Returns: Json
      }
      ai_prompt_load_shadow: {
        Args: { p_capability_id: string }
        Returns: Json
      }
      ai_prompt_promote: {
        Args: {
          p_benchmark_run_ids?: string[]
          p_capability_id: string
          p_rollback_version?: string
          p_scorecard?: Json
          p_to_status: string
          p_version: string
        }
        Returns: Json
      }
      ai_session_memory_append: {
        Args: {
          p_increment_turn?: boolean
          p_session_id: string
          p_summary_patch?: Json
        }
        Returns: Json
      }
      ai_session_memory_close: { Args: { p_session_id: string }; Returns: Json }
      ai_session_memory_open: {
        Args: {
          p_capability_id?: string
          p_school_id: string
          p_summary?: Json
          p_target_student_id?: string
          p_ttl_minutes?: number
          p_workflow_id?: string
          p_workflow_scope: string
        }
        Returns: Json
      }
      ai_session_memory_read: { Args: { p_session_id: string }; Returns: Json }
      bump_ai_answer_cache_hit: { Args: { p_id: string }; Returns: undefined }
      chat_attachment_url_allowed: {
        Args: { _uid?: string; _url: string }
        Returns: boolean
      }
      chat_caller_role: { Args: never; Returns: string }
      chat_can_create_class_group: {
        Args: { _class_id: string; _uid: string }
        Returns: boolean
      }
      chat_can_dm: { Args: { _from: string; _to: string }; Returns: boolean }
      chat_dm_key: { Args: { _a: string; _b: string }; Returns: string }
      claim_signup_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      default_school_id: { Args: never; Returns: string }
      emit_academic_event: {
        Args: {
          _class_id?: string
          _entity_id?: string
          _entity_type: string
          _event_type: string
          _payload?: Json
          _school_id?: string
          _student_id?: string
          _teacher_id?: string
        }
        Returns: string
      }
      ensure_default_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      ensure_student_academic_profile: {
        Args: { _student_id: string }
        Returns: string
      }
      get_auth_context: {
        Args: never
        Returns: {
          email: string
          full_name: string
          is_active: boolean
          photo_url: string
          role: Database["public"]["Enums"]["app_role"]
          school_id: string
          school_logo_url: string
          school_name: string
          school_slug: string
          user_id: string
        }[]
      }
      get_chat_contacts: {
        Args: never
        Returns: {
          name: string
          role: string
          user_id: string
        }[]
      }
      get_chat_groups: {
        Args: never
        Returns: {
          conversation_id: string
          kind: string
          last_message: string
          last_time: string
          name: string
          unread: number
        }[]
      }
      get_chat_inbox: {
        Args: never
        Returns: {
          class_id: string
          conversation_id: string
          kind: string
          last_message: string
          last_time: string
          peer_role: string
          peer_user_id: string
          title: string
          unread: number
        }[]
      }
      get_chat_unread_total: { Args: never; Returns: number }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_my_school_id: { Args: never; Returns: string }
      get_teacher_directory: {
        Args: never
        Returns: {
          class_teacher_of: string
          department: string
          full_name: string
          id: string
          is_class_teacher: boolean
          photo_url: string
          qualification: string
          school_id: string
          status: string
          subject: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_battle_participant: { Args: { _battle_id: string }; Returns: boolean }
      is_chat_participant: {
        Args: { _conversation_id: string; _user_id?: string }
        Returns: boolean
      }
      is_class_teacher_of_class: {
        Args: { _class_id: string; _uid: string }
        Returns: boolean
      }
      is_class_teacher_of_student: {
        Args: { _student_id: string; _uid: string }
        Returns: boolean
      }
      is_principal_or_admin: { Args: { _uid: string }; Returns: boolean }
      link_portal_on_auth: { Args: { _uid?: string }; Returns: undefined }
      match_ai_answer_cache: {
        Args: {
          p_class_level: number
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
          p_subjects?: string[]
        }
        Returns: {
          answer: string
          chapter: string
          concept: string
          id: string
          original_question: string
          similarity: number
          subject: string
          topic: string
        }[]
      }
      match_question_bank: {
        Args: {
          p_class_level: number
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
          p_subjects?: string[]
        }
        Returns: {
          chapter: string
          concept: string
          correct_index: number
          explanation: string
          id: string
          options: Json
          question: string
          similarity: number
          subject: string
          topic: string
        }[]
      }
      normalize_phone: { Args: { _raw: string }; Returns: string }
      process_academic_event: { Args: { _event_id: string }; Returns: boolean }
      process_pending_academic_events: {
        Args: { _limit?: number }
        Returns: number
      }
      progression_league_for_xp: { Args: { _xp: number }; Returns: string }
      progression_level_for_xp: { Args: { _xp: number }; Returns: number }
      progression_xp_for_level: { Args: { _level: number }; Returns: number }
      publish_due_scheduled_homework:
        | { Args: never; Returns: number }
        | { Args: { _school_id?: string }; Returns: number }
      refresh_student_academic_profile: {
        Args: { _student_id: string }
        Returns: string
      }
      require_active_profile: { Args: never; Returns: string }
      rpc_academic_revision_plan: { Args: never; Returns: Json }
      rpc_accept_battle_invite: {
        Args: { _invite_id: string }
        Returns: string
      }
      rpc_add_community_answer: {
        Args: { _body: string; _doubt_id: string; _image_url?: string }
        Returns: string
      }
      rpc_apply_progression: {
        Args: {
          _amount_override?: number
          _idempotency_key?: string
          _meta?: Json
          _rule_code: string
          _source_id?: string
          _source_type?: string
          _target_user_id?: string
        }
        Returns: Json
      }
      rpc_assign_concept_recovery: {
        Args: {
          _accuracy?: number
          _chapter?: string
          _concept?: string
          _source_id?: string
          _source_type?: string
          _subconcept?: string
          _subject: string
        }
        Returns: string
      }
      rpc_backfill_question_concepts: { Args: never; Returns: Json }
      rpc_battle_curriculum:
        | { Args: { _subject: string }; Returns: Json }
        | { Args: { _class_id?: string; _subject: string }; Returns: Json }
      rpc_battle_feed: {
        Args: { _limit?: number }
        Returns: {
          actor_name: string
          actor_user_id: string
          battle_id: string | null
          class_id: string | null
          created_at: string
          detail: string
          icon: string | null
          id: string
          kind: string
          opponent_name: string | null
          school_id: string | null
          subject: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "battle_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rpc_battle_monitor: { Args: { _battle_id: string }; Returns: Json }
      rpc_bulk_upsert_attendance: { Args: { _rows: Json }; Returns: Json }
      rpc_cache_agent_insight: {
        Args: {
          _agent_type: string
          _payload: Json
          _source?: string
          _ttl_hours?: number
        }
        Returns: undefined
      }
      rpc_challenge_student: {
        Args: {
          _chapter?: string
          _count?: number
          _difficulty?: string
          _opponent_user_id: string
          _per_q?: number
          _subject: string
          _topic?: string
        }
        Returns: string
      }
      rpc_classmates: {
        Args: never
        Returns: {
          current_streak: number
          equipped_badge: string
          full_name: string
          level: number
          roll_number: string
          student_id: string
          user_id: string
          wins: number
          xp: number
        }[]
      }
      rpc_complete_recovery_assignment: {
        Args: {
          _assignment_id: string
          _questions_completed?: number
          _questions_correct?: number
        }
        Returns: Json
      }
      rpc_complete_revision: { Args: { _id: string }; Returns: undefined }
      rpc_compute_session_analytics: {
        Args: { _session_id?: string }
        Returns: Json
      }
      rpc_create_class_battle: {
        Args: {
          _chapter?: string
          _class_id?: string
          _count?: number
          _difficulty?: string
          _per_q?: number
          _subject: string
          _topic?: string
        }
        Returns: string
      }
      rpc_create_class_group: {
        Args: { _class_id: string; _title?: string }
        Returns: {
          class_id: string | null
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          kind: string
          school_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_create_community_doubt: {
        Args: {
          _body: string
          _chapter: string
          _concept: string
          _image_url?: string
          _subject: string
          _subject_id?: string
          _title: string
        }
        Returns: string
      }
      rpc_create_open_battle: {
        Args: {
          _chapter?: string
          _class_id?: string
          _count?: number
          _difficulty?: string
          _per_q?: number
          _subject: string
          _topic?: string
        }
        Returns: string
      }
      rpc_create_quick_battle: {
        Args: {
          _chapter?: string
          _class_id?: string
          _count?: number
          _difficulty?: string
          _per_q?: number
          _subject: string
          _topic?: string
        }
        Returns: string
      }
      rpc_create_teacher_group: {
        Args: { _title?: string }
        Returns: {
          class_id: string | null
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          kind: string
          school_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_create_template_solo_battle: {
        Args: {
          _chapter: string
          _class_id?: string
          _count?: number
          _difficulty?: string
          _per_q?: number
          _questions?: Json
          _subject: string
        }
        Returns: string
      }
      rpc_decision_engine_rollout_summary_v1: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      rpc_delete_chat_message: {
        Args: { _message_id: string }
        Returns: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_url: string | null
          content: string
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          has_attachment: boolean
          id: string
          is_read: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          school_id: string | null
          sender_id: string
          subject: string | null
          thread_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_delete_message: {
        Args: { _message_id: string }
        Returns: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_url: string | null
          content: string
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          has_attachment: boolean
          id: string
          is_read: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          school_id: string | null
          sender_id: string
          subject: string | null
          thread_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_dpp_pick_from_bank: {
        Args: { _count?: number; _difficulty?: string; _dpp_id: string }
        Returns: number
      }
      rpc_dpp_start: { Args: { _dpp_id: string }; Returns: string }
      rpc_dpp_submit: {
        Args: { _answers?: Json; _attempt_id: string }
        Returns: Json
      }
      rpc_ensure_battle_report: {
        Args: { _participant_id: string }
        Returns: Json
      }
      rpc_ensure_class_group: {
        Args: { _class_id: string }
        Returns: {
          class_id: string | null
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          kind: string
          school_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ensure_dm: {
        Args: { _peer_user_id: string }
        Returns: {
          class_id: string | null
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          kind: string
          school_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ensure_featured_battle: { Args: { _kind: string }; Returns: string }
      rpc_ensure_featured_battles_all: { Args: never; Returns: Json }
      rpc_ensure_teacher_group: {
        Args: never
        Returns: {
          class_id: string | null
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          kind: string
          school_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_finish_battle: {
        Args: { _participant_id: string }
        Returns: undefined
      }
      rpc_finish_practice_session: {
        Args: {
          _attempts?: Json
          _ended_by_user?: boolean
          _ended_normally?: boolean
          _session_id: string
        }
        Returns: Json
      }
      rpc_generate_battle: {
        Args: { _battle_id: string; _count?: number }
        Returns: number
      }
      rpc_get_academic_brain: { Args: never; Returns: Json }
      rpc_get_battle_report: {
        Args: { _participant_id: string }
        Returns: Json
      }
      rpc_get_cached_agent_insight: {
        Args: { _agent_type: string }
        Returns: Json
      }
      rpc_get_concept_recovery_report: {
        Args: { _source_id: string; _source_type: string }
        Returns: Json
      }
      rpc_get_my_student_identity: {
        Args: never
        Returns: {
          class_category: string
          class_display_name: string
          class_id: string
          class_name: string
          class_section: string
          has_student_role: boolean
          role: Database["public"]["Enums"]["app_role"]
          school_id: string
          student_id: string
          user_id: string
        }[]
      }
      rpc_get_recovery_assignment: {
        Args: { _assignment_id: string }
        Returns: Json
      }
      rpc_get_student_progression: {
        Args: { _user_id?: string }
        Returns: Json
      }
      rpc_join_battle_by_code: { Args: { _code: string }; Returns: string }
      rpc_leaderboard: {
        Args: {
          _category?: string
          _limit?: number
          _scope?: string
          _subject?: string
        }
        Returns: {
          class_label: string
          detail: string
          equipped_badge: string
          full_name: string
          roll_number: string
          score: number
          user_id: string
        }[]
      }
      rpc_list_conversations: {
        Args: { _limit?: number; _search?: string }
        Returns: {
          class_id: string
          conversation_id: string
          kind: string
          last_message: string
          last_time: string
          peer_role: string
          peer_user_id: string
          title: string
          unread: number
        }[]
      }
      rpc_list_practice_history: {
        Args: {
          _date_from?: string
          _date_to?: string
          _limit?: number
          _practice_mode?: string
          _search?: string
          _sort?: string
          _subject?: string
        }
        Returns: {
          accuracy: number | null
          analysis_snapshot: Json | null
          board: string | null
          chapter: string | null
          class_level: number | null
          correct_count: number
          created_at: string
          difficulty: string | null
          ended_by_user: boolean | null
          ended_normally: boolean | null
          finished_at: string | null
          id: string
          practice_mode: string | null
          question_count: number
          saved_at: string | null
          school_id: string | null
          score: number
          skipped_count: number
          stream: string | null
          student_id: string | null
          subject: string
          time_limit_sec: number | null
          total_time_ms: number | null
          user_id: string
          wrong_count: number
          xp_earned: number
        }[]
        SetofOptions: {
          from: "*"
          to: "practice_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rpc_mark_best_community_answer: {
        Args: { _answer_id: string }
        Returns: undefined
      }
      rpc_mark_conversation_read: {
        Args: { _conversation_id: string }
        Returns: number
      }
      rpc_mark_group_messages_read: {
        Args: { _conversation_id: string }
        Returns: number
      }
      rpc_mark_messages_read: {
        Args: { _peer_user_id: string }
        Returns: number
      }
      rpc_mirror_battle_answer: {
        Args: { _participant_id: string; _question_id: string }
        Returns: string
      }
      rpc_open_conversation: {
        Args: { _before?: string; _conversation_id: string; _limit?: number }
        Returns: {
          attachment_id: string
          attachment_mime: string
          attachment_name: string
          attachment_size: number
          attachment_url: string
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string
          is_read: boolean
          message_id: string
          message_type: string
          receiver_id: string
          reply_preview: string
          reply_to_id: string
          sender_id: string
          sender_name: string
        }[]
      }
      rpc_parent_child_snapshot: {
        Args: { _student_id?: string }
        Returns: Json
      }
      rpc_parent_concept_analytics: { Args: never; Returns: Json }
      rpc_parent_weekly_digest: { Args: never; Returns: Json }
      rpc_pick_question_templates: {
        Args: {
          _chapter: string
          _class: number
          _count?: number
          _subject: string
        }
        Returns: {
          chapter: string
          class: number
          concept: string | null
          created_at: string
          difficulty: string | null
          explanation_template: string
          id: string
          is_active: boolean
          school_id: string | null
          subconcept: string | null
          subject: string
          template_data: Json
          template_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "question_templates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rpc_post_assessment_concept_analysis: {
        Args: { _source_id: string; _source_type: string }
        Returns: Json
      }
      rpc_principal_concept_analytics: { Args: never; Returns: Json }
      rpc_principal_school_health: { Args: never; Returns: Json }
      rpc_progression_leaderboard: {
        Args: {
          _limit?: number
          _metric?: string
          _period?: string
          _scope?: string
          _subject?: string
        }
        Returns: Json
      }
      rpc_record_community_doubt_view: {
        Args: { _doubt_id: string }
        Returns: number
      }
      rpc_record_concept_mistake: {
        Args: {
          _assessment_type: string
          _chapter?: string
          _class_level?: number
          _concept?: string
          _correct_answer?: Json
          _explanation?: string
          _options?: Json
          _question_id?: string
          _question_text?: string
          _source_id: string
          _student_answer?: Json
          _subconcept?: string
          _subject?: string
        }
        Returns: string
      }
      rpc_record_question_attempt: {
        Args: {
          _bank_question_id?: string
          _correct_answer: Json
          _generated_question: Json
          _hint_used?: boolean
          _is_correct: boolean
          _meta?: Json
          _score?: number
          _selected_answer: Json
          _session_id: string
          _skipped?: boolean
          _source?: string
          _template_id?: string
          _time_taken_ms?: number
        }
        Returns: string
      }
      rpc_recovery_v2: {
        Args: never
        Returns: {
          chapter: string
          concept: string
          consistency: number
          evidence_strength: number
          growth_trend: number
          priority: number
          reason: Json
          recovery_need: number
          subconcept: string
          subject: string
          understanding: number
        }[]
      }
      rpc_refresh_academic_brain: { Args: never; Returns: Json }
      rpc_refresh_featured_battles: { Args: never; Returns: Json }
      rpc_revision_plan_v2: {
        Args: never
        Returns: {
          chapter: string
          concept: string
          evidence_strength: number
          forgetting_events_count: number
          priority: number
          reason: Json
          retention: number
          subconcept: string
          subject: string
          understanding: number
        }[]
      }
      rpc_rotate_featured_battles: { Args: never; Returns: Json }
      rpc_save_battle_ai_insights: {
        Args: { _insights: Json; _participant_id: string }
        Returns: undefined
      }
      rpc_save_practice_session: {
        Args: { _session_id: string; _snapshot?: Json }
        Returns: Json
      }
      rpc_search_chat: {
        Args: { _limit?: number; _query: string }
        Returns: {
          conversation_id: string
          message_id: string
          rank_at: string
          result_kind: string
          snippet: string
          title: string
        }[]
      }
      rpc_send_chat_message: {
        Args: {
          _attachment_mime?: string
          _attachment_name?: string
          _attachment_size?: number
          _attachment_url?: string
          _content?: string
          _conversation_id?: string
          _receiver_id?: string
          _reply_to_id?: string
        }
        Returns: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_url: string | null
          content: string
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          has_attachment: boolean
          id: string
          is_read: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          school_id: string | null
          sender_id: string
          subject: string | null
          thread_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_send_direct_message:
        | {
            Args: { _content: string; _receiver_id: string }
            Returns: {
              attachment_mime: string | null
              attachment_name: string | null
              attachment_url: string | null
              content: string
              conversation_id: string | null
              created_at: string
              deleted_at: string | null
              deleted_by: string | null
              has_attachment: boolean
              id: string
              is_read: boolean
              read_at: string | null
              receiver_id: string | null
              reply_to_id: string | null
              school_id: string | null
              sender_id: string
              subject: string | null
              thread_id: string | null
            }
            SetofOptions: {
              from: "*"
              to: "messages"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              _attachment_mime?: string
              _attachment_name?: string
              _attachment_url?: string
              _content: string
              _receiver_id: string
              _reply_to_id?: string
            }
            Returns: {
              attachment_mime: string | null
              attachment_name: string | null
              attachment_url: string | null
              content: string
              conversation_id: string | null
              created_at: string
              deleted_at: string | null
              deleted_by: string | null
              has_attachment: boolean
              id: string
              is_read: boolean
              read_at: string | null
              receiver_id: string | null
              reply_to_id: string | null
              school_id: string | null
              sender_id: string
              subject: string | null
              thread_id: string | null
            }
            SetofOptions: {
              from: "*"
              to: "messages"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      rpc_send_group_message: {
        Args: {
          _attachment_mime?: string
          _attachment_name?: string
          _attachment_url?: string
          _content: string
          _conversation_id: string
          _reply_to_id?: string
        }
        Returns: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_url: string | null
          content: string
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          has_attachment: boolean
          id: string
          is_read: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          school_id: string | null
          sender_id: string
          subject: string | null
          thread_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_set_featured_badges: {
        Args: { _badges: string[] }
        Returns: undefined
      }
      rpc_start_practice_session: {
        Args: {
          _chapter: string
          _count?: number
          _difficulty?: string
          _practice_mode?: string
          _subject: string
          _time_limit_sec?: number
        }
        Returns: string
      }
      rpc_student_academic_snapshot: { Args: never; Returns: Json }
      rpc_student_academic_snapshot_internal: {
        Args: { _student_id: string; _uid: string }
        Returns: Json
      }
      rpc_student_concept_mastery: { Args: never; Returns: Json }
      rpc_student_improvement_plans: { Args: never; Returns: Json }
      rpc_student_performance_charts: { Args: never; Returns: Json }
      rpc_student_recovery_zone: { Args: never; Returns: Json }
      rpc_student_revision_queue: { Args: never; Returns: Json }
      rpc_submit_battle_answer: {
        Args: {
          _participant_id: string
          _question_id: string
          _selected_index: number
          _time_ms?: number
        }
        Returns: Json
      }
      rpc_submit_recovery_answer: {
        Args: {
          _is_correct: boolean
          _question_id: string
          _student_answer: Json
        }
        Returns: Json
      }
      rpc_teacher_battle_reports: {
        Args: { _battle_id: string }
        Returns: Json
      }
      rpc_teacher_class_insights: { Args: { _class_id: string }; Returns: Json }
      rpc_teacher_class_progression_insights: {
        Args: { _class_id: string }
        Returns: Json
      }
      rpc_teacher_concept_analytics: {
        Args: { _class_id: string }
        Returns: Json
      }
      rpc_teacher_doubt_dashboard: { Args: never; Returns: Json }
      rpc_toggle_question_bookmark: {
        Args: { _bookmarked: boolean; _question_id: string }
        Returns: boolean
      }
      rpc_vote_community_answer: {
        Args: { _answer_id: string }
        Returns: number
      }
      rpc_vote_community_doubt: { Args: { _doubt_id: string }; Returns: number }
      rpc_weak_areas_v2: {
        Args: never
        Returns: {
          chapter: string
          concept: string
          consistency: number
          evidence_strength: number
          growth_trend: number
          priority: number
          reason: Json
          subconcept: string
          subject: string
          understanding: number
        }[]
      }
      same_school: { Args: { _school_id: string }; Returns: boolean }
      student_class_id: { Args: { _user_id: string }; Returns: string }
      teacher_teaches_class: {
        Args: { _class_id: string; _user_id: string }
        Returns: boolean
      }
      teacher_teaches_class_subject: {
        Args: {
          _class_id: string
          _subject?: string
          _subject_id?: string
          _user_id: string
        }
        Returns: boolean
      }
      write_academic_audit: {
        Args: {
          _action: string
          _entity_id: string
          _entity_type: string
          _metadata?: Json
          _new?: Json
          _previous?: Json
          _school_id?: string
        }
        Returns: string
      }
    }
    Enums: {
      academic_event_status:
        | "pending"
        | "processing"
        | "processed"
        | "failed"
        | "skipped"
      academic_year_status: "planned" | "active" | "closed" | "archived"
      app_role:
        | "admin"
        | "teacher"
        | "student"
        | "parent"
        | "principal"
        | "super_admin"
      attendance_status: "present" | "absent" | "leave" | "late" | "half_day"
      badge_tier: "bronze" | "silver" | "gold" | "platinum"
      battle_status: "scheduled" | "live" | "finished" | "cancelled"
      battle_type: "mcq" | "rapid" | "timed" | "daily"
      calendar_event_type:
        | "holiday"
        | "exam"
        | "meeting"
        | "sports"
        | "cultural"
        | "deadline"
        | "other"
      case_status: "open" | "in_progress" | "resolved" | "closed"
      dpp_attempt_status: "in_progress" | "submitted"
      dpp_question_kind: "mcq" | "multi" | "numerical" | "short"
      exam_type:
        | "class_test"
        | "unit_test"
        | "half_yearly"
        | "final"
        | "other"
        | "monthly_test"
        | "mid_term"
        | "annual"
        | "practical"
        | "viva"
        | "internal"
        | "surprise_test"
      fee_status: "paid" | "unpaid" | "partial"
      gender_type: "male" | "female" | "other" | "unspecified"
      leave_applicant: "student" | "teacher"
      leave_status: "pending" | "approved" | "rejected"
      notice_audience:
        | "all"
        | "class"
        | "section"
        | "teachers"
        | "parents"
        | "students"
      notice_priority: "low" | "normal" | "high" | "urgent"
      person_status: "active" | "inactive" | "suspended" | "alumni"
      resource_type:
        | "pdf"
        | "video"
        | "link"
        | "notes"
        | "worksheet"
        | "presentation"
        | "other"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      academic_event_status: [
        "pending",
        "processing",
        "processed",
        "failed",
        "skipped",
      ],
      academic_year_status: ["planned", "active", "closed", "archived"],
      app_role: [
        "admin",
        "teacher",
        "student",
        "parent",
        "principal",
        "super_admin",
      ],
      attendance_status: ["present", "absent", "leave", "late", "half_day"],
      badge_tier: ["bronze", "silver", "gold", "platinum"],
      battle_status: ["scheduled", "live", "finished", "cancelled"],
      battle_type: ["mcq", "rapid", "timed", "daily"],
      calendar_event_type: [
        "holiday",
        "exam",
        "meeting",
        "sports",
        "cultural",
        "deadline",
        "other",
      ],
      case_status: ["open", "in_progress", "resolved", "closed"],
      dpp_attempt_status: ["in_progress", "submitted"],
      dpp_question_kind: ["mcq", "multi", "numerical", "short"],
      exam_type: [
        "class_test",
        "unit_test",
        "half_yearly",
        "final",
        "other",
        "monthly_test",
        "mid_term",
        "annual",
        "practical",
        "viva",
        "internal",
        "surprise_test",
      ],
      fee_status: ["paid", "unpaid", "partial"],
      gender_type: ["male", "female", "other", "unspecified"],
      leave_applicant: ["student", "teacher"],
      leave_status: ["pending", "approved", "rejected"],
      notice_audience: [
        "all",
        "class",
        "section",
        "teachers",
        "parents",
        "students",
      ],
      notice_priority: ["low", "normal", "high", "urgent"],
      person_status: ["active", "inactive", "suspended", "alumni"],
      resource_type: [
        "pdf",
        "video",
        "link",
        "notes",
        "worksheet",
        "presentation",
        "other",
      ],
    },
  },
} as const
