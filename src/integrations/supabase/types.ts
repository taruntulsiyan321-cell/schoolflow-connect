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
      classes: {
        Row: {
          academic_year: string
          created_at: string
          id: string
          name: string
          section: string
        }
        Insert: {
          academic_year?: string
          created_at?: string
          id?: string
          name: string
          section: string
        }
        Update: {
          academic_year?: string
          created_at?: string
          id?: string
          name?: string
          section?: string
        }
        Relationships: []
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
          parent_user_id: string | null
          photo_url: string | null
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
          parent_user_id?: string | null
          photo_url?: string | null
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
          parent_user_id?: string | null
          photo_url?: string | null
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
      admin_assign_role: {
        Args: {
          _identifier: string
          _role: Database["public"]["Enums"]["app_role"]
        }
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
      student_class_id: { Args: { _user_id: string }; Returns: string }
      teacher_teaches_class: {
        Args: { _class_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "teacher" | "student" | "parent" | "principal"
      attendance_status: "present" | "absent" | "leave"
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
