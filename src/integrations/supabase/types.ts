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
      academic_daily_activity: {
        Row: {
          activity_date: string
          battle_count: number
          dpp_count: number
          homework_count: number
          practice_minutes: number
          self_practice_count: number
          user_id: string
        }
        Insert: {
          activity_date: string
          battle_count?: number
          dpp_count?: number
          homework_count?: number
          practice_minutes?: number
          self_practice_count?: number
          user_id: string
        }
        Update: {
          activity_date?: string
          battle_count?: number
          dpp_count?: number
          homework_count?: number
          practice_minutes?: number
          self_practice_count?: number
          user_id?: string
        }
        Relationships: []
      }
      ai_explanations: {
        Row: {
          cache_key: string
          created_at: string
          payload: Json
          subject: string | null
          topic: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string
          payload: Json
          subject?: string | null
          topic?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string
          payload?: Json
          subject?: string | null
          topic?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          currency: string
          enable_fees: boolean
          enable_leaves: boolean
          enable_notices: boolean
          id: boolean
          locale: string
          school_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          currency?: string
          enable_fees?: boolean
          enable_leaves?: boolean
          enable_notices?: boolean
          id?: boolean
          locale?: string
          school_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          currency?: string
          enable_fees?: boolean
          enable_leaves?: boolean
          enable_notices?: boolean
          id?: boolean
          locale?: string
          school_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      attendance: {
        Row: {
          class_id: string
          created_at: string
          date: string
          id: string
          marked_by: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
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
          student_id?: string | null
        }
        Relationships: []
      }
      attendance_locks: {
        Row: {
          class_id: string
          date: string
          locked_at: string
          locked_by: string | null
        }
        Insert: {
          class_id: string
          date: string
          locked_at?: string
          locked_by?: string | null
        }
        Update: {
          class_id?: string
          date?: string
          locked_at?: string
          locked_by?: string | null
        }
        Relationships: []
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
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json | null
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
          selected_index: number
          time_ms: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_correct: boolean
          participant_id: string
          question_id: string
          selected_index: number
          time_ms?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_correct?: boolean
          participant_id?: string
          question_id?: string
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
        ]
      }
      battle_invites: {
        Row: {
          battle_id: string
          created_at: string
          id: string
          invited_user_id: string
          inviter_user_id: string
          status: string
        }
        Insert: {
          battle_id: string
          created_at?: string
          id?: string
          invited_user_id: string
          inviter_user_id: string
          status?: string
        }
        Update: {
          battle_id?: string
          created_at?: string
          id?: string
          invited_user_id?: string
          inviter_user_id?: string
          status?: string
        }
        Relationships: []
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
        ]
      }
      battles: {
        Row: {
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
          source: string
          starts_at: string
          status: Database["public"]["Enums"]["battle_status"]
          subject: string
          title: string
          topic: string | null
          type: Database["public"]["Enums"]["battle_type"]
        }
        Insert: {
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
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["battle_status"]
          subject: string
          title: string
          topic?: string | null
          type?: Database["public"]["Enums"]["battle_type"]
        }
        Update: {
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
        ]
      }
      class_timetables: {
        Row: {
          class_id: string
          grid: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          class_id: string
          grid?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          class_id?: string
          grid?: Json
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
        ]
      }
      classes: {
        Row: {
          academic_year: string
          category: string | null
          created_at: string
          display_name: string | null
          id: string
          kind: string
          name: string | null
          section: string | null
        }
        Insert: {
          academic_year?: string
          category?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          kind?: string
          name?: string | null
          section?: string | null
        }
        Update: {
          academic_year?: string
          category?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          kind?: string
          name?: string | null
          section?: string | null
        }
        Relationships: []
      }
      concept_mastery: {
        Row: {
          chapter: string | null
          class_level: number | null
          concept: string
          correct_attempts: number
          id: string
          last_attempt_at: string | null
          mastery_score: number
          mistake_count: number
          recovery_attempts: number
          recovery_correct: number
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
          concept: string
          correct_attempts?: number
          id?: string
          last_attempt_at?: string | null
          mastery_score?: number
          mistake_count?: number
          recovery_attempts?: number
          recovery_correct?: number
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
          concept?: string
          correct_attempts?: number
          id?: string
          last_attempt_at?: string | null
          mastery_score?: number
          mistake_count?: number
          recovery_attempts?: number
          recovery_correct?: number
          student_id?: string | null
          subconcept?: string | null
          subject?: string
          total_attempts?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
        ]
      }
      dpp_attempts: {
        Row: {
          correct_count: number
          dpp_id: string
          id: string
          max_score: number
          score: number
          started_at: string
          status: Database["public"]["Enums"]["dpp_attempt_status"]
          student_id: string | null
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
          score?: number
          started_at?: string
          status?: Database["public"]["Enums"]["dpp_attempt_status"]
          student_id?: string | null
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
          score?: number
          started_at?: string
          status?: Database["public"]["Enums"]["dpp_attempt_status"]
          student_id?: string | null
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
        ]
      }
      dpps: {
        Row: {
          chapter: string | null
          class_id: string
          created_at: string
          created_by: string
          difficulty: string
          due_at: string | null
          duration_sec: number
          id: string
          instructions: string | null
          is_published: boolean
          negative_marking: number
          question_count: number
          subject: string
          title: string
          topic: string | null
          total_marks: number
          updated_at: string
        }
        Insert: {
          chapter?: string | null
          class_id: string
          created_at?: string
          created_by: string
          difficulty?: string
          due_at?: string | null
          duration_sec?: number
          id?: string
          instructions?: string | null
          is_published?: boolean
          negative_marking?: number
          question_count?: number
          subject: string
          title: string
          topic?: string | null
          total_marks?: number
          updated_at?: string
        }
        Update: {
          chapter?: string | null
          class_id?: string
          created_at?: string
          created_by?: string
          difficulty?: string
          due_at?: string | null
          duration_sec?: number
          id?: string
          instructions?: string | null
          is_published?: boolean
          negative_marking?: number
          question_count?: number
          subject?: string
          title?: string
          topic?: string | null
          total_marks?: number
          updated_at?: string
        }
        Relationships: []
      }
      exams: {
        Row: {
          class_id: string
          created_at: string
          created_by: string | null
          exam_date: string | null
          exam_type: Database["public"]["Enums"]["exam_type"]
          id: string
          max_marks: number
          name: string
          subject: string
        }
        Insert: {
          class_id: string
          created_at?: string
          created_by?: string | null
          exam_date?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          max_marks?: number
          name: string
          subject: string
        }
        Update: {
          class_id?: string
          created_at?: string
          created_by?: string | null
          exam_date?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          max_marks?: number
          name?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      fees: {
        Row: {
          amount: number
          created_at: string
          due_date: string | null
          id: string
          month: string
          notes: string | null
          paid_amount: number
          status: Database["public"]["Enums"]["fee_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          due_date?: string | null
          id?: string
          month: string
          notes?: string | null
          paid_amount?: number
          status?: Database["public"]["Enums"]["fee_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string | null
          id?: string
          month?: string
          notes?: string | null
          paid_amount?: number
          status?: Database["public"]["Enums"]["fee_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
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
          class_id: string
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          id: string
          subject: string
          title: string
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          subject?: string
          title: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          subject?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          content: string
          created_at: string
          grade: string | null
          graded_at: string | null
          homework_id: string
          id: string
          status: string
          student_id: string
          submitted_at: string | null
          teacher_remarks: string | null
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          grade?: string | null
          graded_at?: string | null
          homework_id: string
          id?: string
          status?: string
          student_id: string
          submitted_at?: string | null
          teacher_remarks?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          grade?: string | null
          graded_at?: string | null
          homework_id?: string
          id?: string
          status?: string
          student_id?: string
          submitted_at?: string | null
          teacher_remarks?: string | null
          updated_at?: string
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
            foreignKeyName: "hw_sub_student_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          reviewed_at: string | null
          reviewed_by: string | null
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
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
          student_id?: string | null
          to_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      library_books: {
        Row: {
          author: string | null
          available_copies: number
          category: string | null
          created_at: string
          id: string
          isbn: string | null
          shelf_location: string | null
          title: string
          total_copies: number
          updated_at: string
        }
        Insert: {
          author?: string | null
          available_copies?: number
          category?: string | null
          created_at?: string
          id?: string
          isbn?: string | null
          shelf_location?: string | null
          title: string
          total_copies?: number
          updated_at?: string
        }
        Update: {
          author?: string | null
          available_copies?: number
          category?: string | null
          created_at?: string
          id?: string
          isbn?: string | null
          shelf_location?: string | null
          title?: string
          total_copies?: number
          updated_at?: string
        }
        Relationships: []
      }
      library_checkouts: {
        Row: {
          checked_out_at: string
          created_at: string
          due_date: string | null
          id: string
          library_books_id: string
          returned_at: string | null
          status: string
          student_id: string
        }
        Insert: {
          checked_out_at?: string
          created_at?: string
          due_date?: string | null
          id?: string
          library_books_id: string
          returned_at?: string | null
          status?: string
          student_id: string
        }
        Update: {
          checked_out_at?: string
          created_at?: string
          due_date?: string | null
          id?: string
          library_books_id?: string
          returned_at?: string | null
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
        ]
      }
      marks: {
        Row: {
          created_at: string
          exam_id: string
          id: string
          marks_obtained: number
          remarks: string | null
          student_id: string
        }
        Insert: {
          created_at?: string
          exam_id: string
          id?: string
          marks_obtained?: number
          remarks?: string | null
          student_id: string
        }
        Update: {
          created_at?: string
          exam_id?: string
          id?: string
          marks_obtained?: number
          remarks?: string | null
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
            foreignKeyName: "marks_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          is_read: boolean
          receiver_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_read?: boolean
          receiver_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_read?: boolean
          receiver_id?: string
          sender_id?: string
        }
        Relationships: []
      }
      notices: {
        Row: {
          audience: Database["public"]["Enums"]["notice_audience"]
          body: string
          class_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          posted_by: string | null
          revoked_at: string | null
          title: string
        }
        Insert: {
          audience?: Database["public"]["Enums"]["notice_audience"]
          body: string
          class_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          posted_by?: string | null
          revoked_at?: string | null
          title: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["notice_audience"]
          body?: string
          class_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          posted_by?: string | null
          revoked_at?: string | null
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
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      parent_academic_alerts: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          parent_user_id: string
          read: boolean
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
          student_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_academic_alerts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          chapter: string
          correct_count: number
          created_at: string
          finished_at: string | null
          id: string
          question_count: number
          score: number
          student_id: string | null
          subject: string
          user_id: string
        }
        Insert: {
          chapter: string
          correct_count?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          question_count?: number
          score?: number
          student_id?: string | null
          subject: string
          user_id: string
        }
        Update: {
          chapter?: string
          correct_count?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          question_count?: number
          score?: number
          student_id?: string | null
          subject?: string
          user_id?: string
        }
        Relationships: [
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
          phone: string | null
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          phone?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      question_attempts: {
        Row: {
          correct_answer: Json
          created_at: string
          generated_question: Json
          id: string
          is_correct: boolean | null
          score: number
          selected_answer: Json | null
          session_id: string | null
          student_id: string | null
          template_id: string
          user_id: string
        }
        Insert: {
          correct_answer: Json
          created_at?: string
          generated_question: Json
          id?: string
          is_correct?: boolean | null
          score?: number
          selected_answer?: Json | null
          session_id?: string | null
          student_id?: string | null
          template_id: string
          user_id: string
        }
        Update: {
          correct_answer?: Json
          created_at?: string
          generated_question?: Json
          id?: string
          is_correct?: boolean | null
          score?: number
          selected_answer?: Json | null
          session_id?: string | null
          student_id?: string | null
          template_id?: string
          user_id?: string
        }
        Relationships: [
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
          chapter: string | null
          class_level: number | null
          concept: string | null
          correct_index: number
          created_at: string
          created_by: string | null
          difficulty: string
          explanation: string | null
          id: string
          is_approved: boolean
          options: Json
          question: string
          source: string | null
          subconcept: string | null
          subject: string
          topic: string | null
        }
        Insert: {
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          correct_index: number
          created_at?: string
          created_by?: string | null
          difficulty?: string
          explanation?: string | null
          id?: string
          is_approved?: boolean
          options: Json
          question: string
          source?: string | null
          subconcept?: string | null
          subject: string
          topic?: string | null
        }
        Update: {
          chapter?: string | null
          class_level?: number | null
          concept?: string | null
          correct_index?: number
          created_at?: string
          created_by?: string | null
          difficulty?: string
          explanation?: string | null
          id?: string
          is_approved?: boolean
          options?: Json
          question?: string
          source?: string | null
          subconcept?: string | null
          subject?: string
          topic?: string | null
        }
        Relationships: []
      }
      question_templates: {
        Row: {
          chapter: string
          class: number
          concept: string | null
          created_at: string
          explanation_template: string
          id: string
          is_active: boolean
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
          explanation_template?: string
          id?: string
          is_active?: boolean
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
          explanation_template?: string
          id?: string
          is_active?: boolean
          subconcept?: string | null
          subject?: string
          template_data?: Json
          template_type?: string
        }
        Relationships: []
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
          student_id?: string | null
          subject?: string
          topic?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revision_queue_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          status?: Database["public"]["Enums"]["case_status"]
          student_id?: string | null
          subject?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
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
          status?: Database["public"]["Enums"]["case_status"]
          updated_at?: string
        }
        Relationships: []
      }
      staff_attendance: {
        Row: {
          created_at: string
          date: string
          id: string
          marked_by: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          teacher_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          teacher_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          marked_by?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          teacher_id?: string
        }
        Relationships: []
      }
      student_badges: {
        Row: {
          badge_code: string
          earned_at: string
          id: string
          tier: Database["public"]["Enums"]["badge_tier"]
          user_id: string
        }
        Insert: {
          badge_code: string
          earned_at?: string
          id?: string
          tier?: Database["public"]["Enums"]["badge_tier"]
          user_id: string
        }
        Update: {
          badge_code?: string
          earned_at?: string
          id?: string
          tier?: Database["public"]["Enums"]["badge_tier"]
          user_id?: string
        }
        Relationships: []
      }
      student_improvement_plans: {
        Row: {
          chapter: string | null
          id: string
          plan: Json
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
          source?: string
          subject?: string
          topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      student_mistakes: {
        Row: {
          assessment_type: string | null
          chapter: string | null
          class_level: number | null
          concept: string | null
          correct_answer: Json | null
          created_at: string
          explanation: string | null
          id: string
          last_wrong_at: string
          mastered: boolean
          options: Json | null
          question_id: string | null
          question_text: string
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
          explanation?: string | null
          id?: string
          last_wrong_at?: string
          mastered?: boolean
          options?: Json | null
          question_id?: string | null
          question_text: string
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
          explanation?: string | null
          id?: string
          last_wrong_at?: string
          mastered?: boolean
          options?: Json | null
          question_id?: string | null
          question_text?: string
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
          times_seen: number
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          question_id: string
          times_seen?: number
          user_id: string
        }
        Update: {
          last_seen_at?: string
          question_id?: string
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
        ]
      }
      student_xp: {
        Row: {
          best_score: number
          best_win_streak: number
          current_streak: number
          equipped_badge: string | null
          last_battle_at: string | null
          level: number
          longest_streak: number
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
          best_score?: number
          best_win_streak?: number
          current_streak?: number
          equipped_badge?: string | null
          last_battle_at?: string | null
          level?: number
          longest_streak?: number
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
          best_score?: number
          best_win_streak?: number
          current_streak?: number
          equipped_badge?: string | null
          last_battle_at?: string | null
          level?: number
          longest_streak?: number
          total_answered?: number
          total_battles?: number
          total_correct?: number
          updated_at?: string
          user_id?: string
          win_streak?: number
          wins?: number
          xp?: number
        }
        Relationships: []
      }
      students: {
        Row: {
          address: string | null
          admission_number: string
          class_id: string | null
          created_at: string
          date_of_birth: string | null
          full_name: string
          id: string
          parent_mobile: string | null
          parent_name: string | null
          parent_portal_email: string | null
          parent_user_id: string | null
          photo_url: string | null
          portal_email: string | null
          portal_phone: string | null
          roll_number: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          admission_number: string
          class_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name: string
          id?: string
          parent_mobile?: string | null
          parent_name?: string | null
          parent_portal_email?: string | null
          parent_user_id?: string | null
          photo_url?: string | null
          portal_email?: string | null
          portal_phone?: string | null
          roll_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          admission_number?: string
          class_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name?: string
          id?: string
          parent_mobile?: string | null
          parent_name?: string | null
          parent_portal_email?: string | null
          parent_user_id?: string | null
          photo_url?: string | null
          portal_email?: string | null
          portal_phone?: string | null
          roll_number?: string | null
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
        ]
      }
      teacher_classes: {
        Row: {
          class_id: string
          id: string
          subject: string | null
          teacher_id: string
        }
        Insert: {
          class_id: string
          id?: string
          subject?: string | null
          teacher_id: string
        }
        Update: {
          class_id?: string
          id?: string
          subject?: string | null
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
            foreignKeyName: "teacher_classes_teacher_id_fkey"
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
          department: string | null
          email: string | null
          employee_id: string | null
          full_name: string
          id: string
          is_class_teacher: boolean
          joining_date: string | null
          mobile: string | null
          notes: string | null
          photo_url: string | null
          qualification: string | null
          salary: number | null
          status: string
          subject: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          class_teacher_of?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          employee_id?: string | null
          full_name: string
          id?: string
          is_class_teacher?: boolean
          joining_date?: string | null
          mobile?: string | null
          notes?: string | null
          photo_url?: string | null
          qualification?: string | null
          salary?: number | null
          status?: string
          subject?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          class_teacher_of?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string
          id?: string
          is_class_teacher?: boolean
          joining_date?: string | null
          mobile?: string | null
          notes?: string | null
          photo_url?: string | null
          qualification?: string | null
          salary?: number | null
          status?: string
          subject?: string | null
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
      _exam_readiness: {
        Args: { _student_id: string; _uid: string }
        Returns: Json
      }
      _humanize_template_type: { Args: { _t: string }; Returns: string }
      _maybe_finish_battle: { Args: { _battle_id: string }; Returns: undefined }
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
      _rebuild_revision_queue: {
        Args: { _student_id: string; _uid: string }
        Returns: undefined
      }
      _recovery_question_count: { Args: { _severity: string }; Returns: number }
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
      ensure_default_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_chat_contacts: {
        Args: never
        Returns: {
          name: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
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
      is_class_teacher_of_student: {
        Args: { _student_id: string; _uid: string }
        Returns: boolean
      }
      is_principal_or_admin: { Args: { _uid: string }; Returns: boolean }
      link_portal_on_auth: { Args: { _uid?: string }; Returns: undefined }
      normalize_phone: { Args: { _raw: string }; Returns: string }
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
      rpc_challenge_student:
        | {
            Args: {
              _chapter?: string
              _count?: number
              _difficulty?: string
              _opponent_user_id: string
              _per_q?: number
              _subject: string
            }
            Returns: string
          }
        | {
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
      rpc_complete_revision: { Args: { _id: string }; Returns: undefined }
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
      rpc_dpp_pick_from_bank: {
        Args: { _count?: number; _difficulty?: string; _dpp_id: string }
        Returns: number
      }
      rpc_dpp_start: { Args: { _dpp_id: string }; Returns: string }
      rpc_dpp_submit: { Args: { _attempt_id: string }; Returns: undefined }
      rpc_ensure_battle_report: {
        Args: { _participant_id: string }
        Returns: Json
      }
      rpc_finish_battle: {
        Args: { _participant_id: string }
        Returns: undefined
      }
      rpc_finish_practice_session: {
        Args: { _session_id: string }
        Returns: Json
      }
      rpc_generate_battle: {
        Args: { _battle_id: string; _count?: number }
        Returns: number
      }
      rpc_get_battle_report: {
        Args: { _participant_id: string }
        Returns: Json
      }
      rpc_get_concept_recovery_report: {
        Args: { _source_id: string; _source_type: string }
        Returns: Json
      }
      rpc_get_recovery_assignment: {
        Args: { _assignment_id: string }
        Returns: Json
      }
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
          explanation_template: string
          id: string
          is_active: boolean
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
          _correct_answer: Json
          _generated_question: Json
          _is_correct?: boolean
          _score?: number
          _selected_answer?: Json
          _session_id: string
          _template_id: string
        }
        Returns: string
      }
      rpc_save_battle_ai_insights: {
        Args: { _insights: Json; _participant_id: string }
        Returns: undefined
      }
      rpc_start_practice_session: {
        Args: { _chapter: string; _count?: number; _subject: string }
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
      rpc_teacher_concept_analytics: {
        Args: { _class_id: string }
        Returns: Json
      }
      student_class_id: { Args: { _user_id: string }; Returns: string }
      teacher_teaches_class: {
        Args: { _class_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "teacher" | "student" | "parent" | "principal"
      attendance_status: "present" | "absent" | "leave"
      badge_tier: "bronze" | "silver" | "gold" | "platinum"
      battle_status: "scheduled" | "live" | "finished" | "cancelled"
      battle_type: "mcq" | "rapid" | "timed" | "daily"
      case_status: "open" | "in_progress" | "resolved" | "closed"
      dpp_attempt_status: "in_progress" | "submitted"
      dpp_question_kind: "mcq" | "multi" | "numerical" | "short"
      exam_type: "class_test" | "unit_test" | "half_yearly" | "final" | "other"
      fee_status: "paid" | "unpaid" | "partial"
      leave_applicant: "student" | "teacher"
      leave_status: "pending" | "approved" | "rejected"
      notice_audience:
        | "all"
        | "class"
        | "section"
        | "teachers"
        | "parents"
        | "students"
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
      app_role: ["admin", "teacher", "student", "parent", "principal"],
      attendance_status: ["present", "absent", "leave"],
      badge_tier: ["bronze", "silver", "gold", "platinum"],
      battle_status: ["scheduled", "live", "finished", "cancelled"],
      battle_type: ["mcq", "rapid", "timed", "daily"],
      case_status: ["open", "in_progress", "resolved", "closed"],
      dpp_attempt_status: ["in_progress", "submitted"],
      dpp_question_kind: ["mcq", "multi", "numerical", "short"],
      exam_type: ["class_test", "unit_test", "half_yearly", "final", "other"],
      fee_status: ["paid", "unpaid", "partial"],
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
    },
  },
} as const
