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
      booking_items: {
        Row: {
          adults: number
          booking_id: string
          breakfast_included: boolean
          check_in: string
          check_out: string
          children: number
          created_at: string
          drivers: number
          early_check_in: boolean
          early_check_in_slot: string | null
          extra_adults: number
          extra_bed: number
          id: string
          late_check_out: boolean
          late_check_out_slot: string | null
          nights: number | null
          notes: string | null
          pet_size: string
          position: number
          rate: number
          room_type: string
          rooms: number
          subtotal: number
          updated_at: string
        }
        Insert: {
          adults?: number
          booking_id: string
          breakfast_included?: boolean
          check_in: string
          check_out: string
          children?: number
          created_at?: string
          drivers?: number
          early_check_in?: boolean
          early_check_in_slot?: string | null
          extra_adults?: number
          extra_bed?: number
          id?: string
          late_check_out?: boolean
          late_check_out_slot?: string | null
          nights?: number | null
          notes?: string | null
          pet_size?: string
          position?: number
          rate?: number
          room_type?: string
          rooms?: number
          subtotal?: number
          updated_at?: string
        }
        Update: {
          adults?: number
          booking_id?: string
          breakfast_included?: boolean
          check_in?: string
          check_out?: string
          children?: number
          created_at?: string
          drivers?: number
          early_check_in?: boolean
          early_check_in_slot?: string | null
          extra_adults?: number
          extra_bed?: number
          id?: string
          late_check_out?: boolean
          late_check_out_slot?: string | null
          nights?: number | null
          notes?: string | null
          pet_size?: string
          position?: number
          rate?: number
          room_type?: string
          rooms?: number
          subtotal?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          adults: number
          advance_paid: number
          amount: number
          booking_reference: string
          check_in: string
          check_out: string
          children: number
          created_at: string
          customer_id: string
          discount: number
          email: string | null
          guest_name: string
          guests: number
          id: string
          internal_notes: string | null
          nights: number | null
          notes: string | null
          payment_status: string
          phone: string | null
          room_details: string | null
          source_quote_id: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          adults?: number
          advance_paid?: number
          amount?: number
          booking_reference?: string
          check_in: string
          check_out: string
          children?: number
          created_at?: string
          customer_id: string
          discount?: number
          email?: string | null
          guest_name: string
          guests?: number
          id?: string
          internal_notes?: string | null
          nights?: number | null
          notes?: string | null
          payment_status?: string
          phone?: string | null
          room_details?: string | null
          source_quote_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          adults?: number
          advance_paid?: number
          amount?: number
          booking_reference?: string
          check_in?: string
          check_out?: string
          children?: number
          created_at?: string
          customer_id?: string
          discount?: number
          email?: string | null
          guest_name?: string
          guests?: number
          id?: string
          internal_notes?: string | null
          nights?: number | null
          notes?: string | null
          payment_status?: string
          phone?: string | null
          room_details?: string | null
          source_quote_id?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_source_quote_id_fkey"
            columns: ["source_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_transactions: {
        Row: {
          active: boolean
          amount: number
          booking_id: string | null
          created_at: string
          customer_id: string | null
          description: string | null
          guest_mobile: string | null
          guest_name: string | null
          id: string
          kind: string
          modified_by: string | null
          notes: string | null
          occurred_at: string
          room_number: string | null
          staff_id: string | null
          staff_name: string | null
          type_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          amount: number
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          description?: string | null
          guest_mobile?: string | null
          guest_name?: string | null
          id?: string
          kind: string
          modified_by?: string | null
          notes?: string | null
          occurred_at?: string
          room_number?: string | null
          staff_id?: string | null
          staff_name?: string | null
          type_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          description?: string | null
          guest_mobile?: string | null
          guest_name?: string | null
          id?: string
          kind?: string
          modified_by?: string | null
          notes?: string | null
          occurred_at?: string
          room_number?: string | null
          staff_id?: string | null
          staff_name?: string | null
          type_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cash_tx_activities: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          created_at: string
          field: string | null
          id: string
          new_value: string | null
          old_value: string | null
          summary: string | null
          tx_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          summary?: string | null
          tx_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          summary?: string | null
          tx_id?: string
        }
        Relationships: []
      }
      complaint_activities: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          complaint_id: string
          created_at: string
          field: string | null
          id: string
          new_value: string | null
          old_value: string | null
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          complaint_id: string
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          complaint_id?: string
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          summary?: string | null
        }
        Relationships: []
      }
      complaint_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      complaints: {
        Row: {
          assigned_to_name: string | null
          assigned_to_staff_id: string | null
          booking_id: string | null
          category: string
          category_other: string | null
          complaint_number: string
          complaint_type: Database["public"]["Enums"]["complaint_type"]
          created_at: string
          customer_id: string | null
          description: string
          entered_by_name: string | null
          entered_by_staff_id: string | null
          id: string
          priority: Database["public"]["Enums"]["complaint_priority"]
          resolved_at: string | null
          room_number: string | null
          status: Database["public"]["Enums"]["complaint_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to_name?: string | null
          assigned_to_staff_id?: string | null
          booking_id?: string | null
          category: string
          category_other?: string | null
          complaint_number?: string
          complaint_type?: Database["public"]["Enums"]["complaint_type"]
          created_at?: string
          customer_id?: string | null
          description: string
          entered_by_name?: string | null
          entered_by_staff_id?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["complaint_priority"]
          resolved_at?: string | null
          room_number?: string | null
          status?: Database["public"]["Enums"]["complaint_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to_name?: string | null
          assigned_to_staff_id?: string | null
          booking_id?: string | null
          category?: string
          category_other?: string | null
          complaint_number?: string
          complaint_type?: Database["public"]["Enums"]["complaint_type"]
          created_at?: string
          customer_id?: string | null
          description?: string
          entered_by_name?: string | null
          entered_by_staff_id?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["complaint_priority"]
          resolved_at?: string | null
          room_number?: string | null
          status?: Database["public"]["Enums"]["complaint_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          anniversary: string | null
          birthday: string | null
          booking_probability: number
          city: string | null
          company_address: string | null
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
          company_address?: string | null
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
          company_address?: string | null
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
      expense_types: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
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
      quote_items: {
        Row: {
          adults: number
          breakfast_included: boolean
          check_in: string
          check_out: string
          children: number
          created_at: string
          drivers: number
          early_check_in: boolean
          early_check_in_slot: string | null
          extra_adults: number
          extra_bed: number
          id: string
          late_check_out: boolean
          late_check_out_slot: string | null
          nights: number | null
          notes: string | null
          pet_size: string
          position: number
          quote_id: string
          rate: number
          room_type: string
          rooms: number
          subtotal: number
          updated_at: string
        }
        Insert: {
          adults?: number
          breakfast_included?: boolean
          check_in: string
          check_out: string
          children?: number
          created_at?: string
          drivers?: number
          early_check_in?: boolean
          early_check_in_slot?: string | null
          extra_adults?: number
          extra_bed?: number
          id?: string
          late_check_out?: boolean
          late_check_out_slot?: string | null
          nights?: number | null
          notes?: string | null
          pet_size?: string
          position?: number
          quote_id: string
          rate?: number
          room_type?: string
          rooms?: number
          subtotal?: number
          updated_at?: string
        }
        Update: {
          adults?: number
          breakfast_included?: boolean
          check_in?: string
          check_out?: string
          children?: number
          created_at?: string
          drivers?: number
          early_check_in?: boolean
          early_check_in_slot?: string | null
          extra_adults?: number
          extra_bed?: number
          id?: string
          late_check_out?: boolean
          late_check_out_slot?: string | null
          nights?: number | null
          notes?: string | null
          pet_size?: string
          position?: number
          quote_id?: string
          rate?: number
          room_type?: string
          rooms?: number
          subtotal?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey"
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
          children: number
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
          children?: number
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
          children?: number
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
      staff: {
        Row: {
          active: boolean
          created_at: string
          id: string
          mobile: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          mobile?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          mobile?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
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
      current_actor: {
        Args: never
        Returns: {
          display_name: string
          role: string
          uid: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      recompute_customer_bookings: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      recompute_customer_stats: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      sweep_stay_completed: { Args: never; Returns: number }
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
      app_role: "admin" | "staff" | "owner"
      booking_status:
        | "Draft"
        | "Confirmed"
        | "Cancelled"
        | "Advance Paid"
        | "Full Paid"
        | "Stay Completed"
        | "Pending"
        | "Checked-In"
        | "Checked-Out"
      complaint_priority: "Low" | "Medium" | "High" | "Critical"
      complaint_status: "Open" | "In Progress" | "Resolved"
      complaint_type: "Room" | "General"
      quote_status:
        | "Pending"
        | "Sent"
        | "Negotiating"
        | "Converted"
        | "No Response"
        | "Failed"
        | "Lost"
        | "Draft"
        | "Negotiation"
        | "Confirmed"
        | "Cancelled"
        | "Completed"
        | "Expired"
        | "Checked In"
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
      app_role: ["admin", "staff", "owner"],
      booking_status: [
        "Draft",
        "Confirmed",
        "Cancelled",
        "Advance Paid",
        "Full Paid",
        "Stay Completed",
        "Pending",
        "Checked-In",
        "Checked-Out",
      ],
      complaint_priority: ["Low", "Medium", "High", "Critical"],
      complaint_status: ["Open", "In Progress", "Resolved"],
      complaint_type: ["Room", "General"],
      quote_status: [
        "Pending",
        "Sent",
        "Negotiating",
        "Converted",
        "No Response",
        "Failed",
        "Lost",
        "Draft",
        "Negotiation",
        "Confirmed",
        "Cancelled",
        "Completed",
        "Expired",
        "Checked In",
      ],
    },
  },
} as const
