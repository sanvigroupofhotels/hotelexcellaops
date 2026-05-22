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
      customers: {
        Row: {
          anniversary: string | null
          birthday: string | null
          booking_probability: number
          city: string | null
          company_name: string | null
          country: string | null
          created_at: string
          customer_reference: string
          email: string | null
          first_contact_date: string
          gst_number: string | null
          guest_name: string
          guest_type: string | null
          id: string
          internal_notes: string | null
          last_stay_date: string | null
          lead_source: string | null
          lost_reason: string | null
          next_action: string | null
          next_followup_date: string | null
          payment_status: string | null
          phone: string | null
          preferred_food: string | null
          preferred_room: string | null
          special_notes: string | null
          state: string | null
          status: string
          tags: string[]
          total_bookings: number
          total_quotes: number
          total_revenue: number
          updated_at: string
          user_id: string
        }
        Insert: {
          anniversary?: string | null
          birthday?: string | null
          booking_probability?: number
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          customer_reference?: string
          email?: string | null
          first_contact_date?: string
          gst_number?: string | null
          guest_name: string
          guest_type?: string | null
          id?: string
          internal_notes?: string | null
          last_stay_date?: string | null
          lead_source?: string | null
          lost_reason?: string | null
          next_action?: string | null
          next_followup_date?: string | null
          payment_status?: string | null
          phone?: string | null
          preferred_food?: string | null
          preferred_room?: string | null
          special_notes?: string | null
          state?: string | null
          status?: string
          tags?: string[]
          total_bookings?: number
          total_quotes?: number
          total_revenue?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          anniversary?: string | null
          birthday?: string | null
          booking_probability?: number
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          customer_reference?: string
          email?: string | null
          first_contact_date?: string
          gst_number?: string | null
          guest_name?: string
          guest_type?: string | null
          id?: string
          internal_notes?: string | null
          last_stay_date?: string | null
          lead_source?: string | null
          lost_reason?: string | null
          next_action?: string | null
          next_followup_date?: string | null
          payment_status?: string | null
          phone?: string | null
          preferred_food?: string | null
          preferred_room?: string | null
          special_notes?: string | null
          state?: string | null
          status?: string
          tags?: string[]
          total_bookings?: number
          total_quotes?: number
          total_revenue?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      followups: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          due_at: string
          id: string
          note: string | null
          quote_id: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          due_at: string
          id?: string
          note?: string | null
          quote_id: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          due_at?: string
          id?: string
          note?: string | null
          quote_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "followups_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      quote_activities: {
        Row: {
          created_at: string
          description: string | null
          id: string
          quote_id: string
          type: Database["public"]["Enums"]["activity_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          quote_id: string
          type: Database["public"]["Enums"]["activity_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          quote_id?: string
          type?: Database["public"]["Enums"]["activity_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_activities_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          adults: number
          booking_probability: number
          breakfast_included: boolean
          check_in: string
          check_out: string
          created_at: string
          customer_id: string | null
          discount: number
          drivers: number
          early_check_in: boolean
          early_check_in_slot: string | null
          email: string | null
          extra_adults: number
          extra_bed: number
          extra_breakfast_guests: number
          group_size: string | null
          guest_name: string
          guests: number
          id: string
          internal_notes: string | null
          late_check_out: boolean
          late_check_out_slot: string | null
          lead_source: string | null
          lost_reason: string | null
          nights: number
          payment_status: string
          pet_charges: boolean
          pet_size: string
          phone: string
          reference_code: string
          room_rate: number
          room_type: string
          rooms: number
          special_requests: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          taxes: number
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          adults?: number
          booking_probability?: number
          breakfast_included?: boolean
          check_in: string
          check_out: string
          created_at?: string
          customer_id?: string | null
          discount?: number
          drivers?: number
          early_check_in?: boolean
          early_check_in_slot?: string | null
          email?: string | null
          extra_adults?: number
          extra_bed?: number
          extra_breakfast_guests?: number
          group_size?: string | null
          guest_name: string
          guests?: number
          id?: string
          internal_notes?: string | null
          late_check_out?: boolean
          late_check_out_slot?: string | null
          lead_source?: string | null
          lost_reason?: string | null
          nights?: number
          payment_status?: string
          pet_charges?: boolean
          pet_size?: string
          phone: string
          reference_code: string
          room_rate?: number
          room_type: string
          rooms?: number
          special_requests?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          taxes?: number
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          adults?: number
          booking_probability?: number
          breakfast_included?: boolean
          check_in?: string
          check_out?: string
          created_at?: string
          customer_id?: string | null
          discount?: number
          drivers?: number
          early_check_in?: boolean
          early_check_in_slot?: string | null
          email?: string | null
          extra_adults?: number
          extra_bed?: number
          extra_breakfast_guests?: number
          group_size?: string | null
          guest_name?: string
          guests?: number
          id?: string
          internal_notes?: string | null
          late_check_out?: boolean
          late_check_out_slot?: string | null
          lead_source?: string | null
          lost_reason?: string | null
          nights?: number
          payment_status?: string
          pet_charges?: boolean
          pet_size?: string
          phone?: string
          reference_code?: string
          room_rate?: number
          room_type?: string
          rooms?: number
          special_requests?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          taxes?: number
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          customer_id: string | null
          due_date: string | null
          id: string
          notes: string | null
          priority: string
          quote_id: string | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          priority?: string
          quote_id?: string | null
          status?: string
          title: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          priority?: string
          quote_id?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      recompute_customer_stats: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
    }
    Enums: {
      activity_type:
        | "created"
        | "edited"
        | "status_changed"
        | "whatsapp_sent"
        | "pdf_generated"
        | "followup_added"
        | "followup_completed"
        | "converted"
        | "note_added"
        | "deleted"
        | "duplicated"
      quote_status:
        | "Pending"
        | "Sent"
        | "Negotiating"
        | "Converted"
        | "No Response"
        | "Failed"
        | "Lost"
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
      activity_type: [
        "created",
        "edited",
        "status_changed",
        "whatsapp_sent",
        "pdf_generated",
        "followup_added",
        "followup_completed",
        "converted",
        "note_added",
        "deleted",
        "duplicated",
      ],
      quote_status: [
        "Pending",
        "Sent",
        "Negotiating",
        "Converted",
        "No Response",
        "Failed",
        "Lost",
      ],
    },
  },
} as const
