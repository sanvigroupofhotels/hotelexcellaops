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
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          after_state: Json | null
          before_state: Json | null
          correlation_id: string | null
          created_at: string
          entity_id: string | null
          entity_reference: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          occurred_at: string
          page: string
          property_id: string | null
          source: string
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_reference?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          page: string
          property_id?: string | null
          source?: string
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_reference?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          page?: string
          property_id?: string | null
          source?: string
          summary?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      booking_activities: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          booking_id: string
          created_at: string
          from_status: string | null
          id: string
          metadata: Json | null
          notes: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          booking_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          booking_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_activities_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_charges: {
        Row: {
          added_by: string | null
          amount: number
          booking_id: string
          category: string
          created_at: string
          id: string
          notes: string | null
          occurred_at: string
          other_description: string | null
          quantity: number
          unit_price: number
          updated_at: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          amount?: number
          booking_id: string
          category: string
          created_at?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          other_description?: string | null
          quantity?: number
          unit_price?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          amount?: number
          booking_id?: string
          category?: string
          created_at?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          other_description?: string | null
          quantity?: number
          unit_price?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
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
      booking_payment_activities: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          booking_id: string
          created_at: string
          field: string | null
          id: string
          new_value: string | null
          old_value: string | null
          payment_id: string | null
          summary: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          booking_id: string
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          payment_id?: string | null
          summary: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          booking_id?: string
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          payment_id?: string | null
          summary?: string
        }
        Relationships: []
      }
      booking_payments: {
        Row: {
          amount: number
          booking_id: string
          collected_by: string
          created_at: string
          customer_id: string | null
          id: string
          is_refund: boolean
          notes: string | null
          occurred_at: string
          ocr_corrections: Json | null
          ocr_data: Json | null
          ocr_extracted_text: string | null
          ocr_image_path: string | null
          paid_to: string | null
          payment_mode: string
          refund_reason: string | null
          updated_at: string
          user_id: string
          utr: string | null
        }
        Insert: {
          amount: number
          booking_id: string
          collected_by: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_refund?: boolean
          notes?: string | null
          occurred_at?: string
          ocr_corrections?: Json | null
          ocr_data?: Json | null
          ocr_extracted_text?: string | null
          ocr_image_path?: string | null
          paid_to?: string | null
          payment_mode: string
          refund_reason?: string | null
          updated_at?: string
          user_id: string
          utr?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string
          collected_by?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_refund?: boolean
          notes?: string | null
          occurred_at?: string
          ocr_corrections?: Json | null
          ocr_data?: Json | null
          ocr_extracted_text?: string | null
          ocr_image_path?: string | null
          paid_to?: string | null
          payment_mode?: string
          refund_reason?: string | null
          updated_at?: string
          user_id?: string
          utr?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_room_assignments: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          room_id: string
          user_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          room_id: string
          user_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_room_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_room_assignments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_tokens: {
        Row: {
          booking_id: string
          created_at: string
          expires_at: string | null
          id: string
          last_accessed_at: string | null
          revoked_at: string | null
          scope: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          revoked_at?: string | null
          scope?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          revoked_at?: string | null
          scope?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_tokens_booking_id_fkey"
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
          allow_full_payment: boolean
          allow_part_payment: boolean
          allow_pay_at_hotel: boolean
          amount: number
          booking_reference: string
          cancel_reason: string | null
          cancel_refund_amount: number | null
          cancel_refund_at: string | null
          cancel_refund_mode: string | null
          check_in: string
          check_out: string
          checkout_override_at: string | null
          checkout_override_balance: number | null
          checkout_override_by: string | null
          checkout_override_reason: string | null
          children: number
          created_at: string
          customer_id: string
          discount: number
          draft_expires_at: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          expected_arrival_at: string | null
          external_ref: string | null
          gateway_order_id: string | null
          gateway_payment_id: string | null
          guest_name: string
          guests: number
          id: string
          integration_id: string | null
          internal_notes: string | null
          lead_id: string | null
          lead_source: string | null
          nights: number | null
          notes: string | null
          part_payment_type: string
          part_payment_value: number
          pay_at_hotel: boolean
          payment_status: string
          phone: string | null
          room_details: string | null
          room_id: string | null
          source_channel: string
          source_quote_id: string | null
          special_requests: string | null
          status: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          tax_rate: number
          taxes: number
          taxes_included: boolean
          total_override: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          adults?: number
          advance_paid?: number
          allow_full_payment?: boolean
          allow_part_payment?: boolean
          allow_pay_at_hotel?: boolean
          amount?: number
          booking_reference?: string
          cancel_reason?: string | null
          cancel_refund_amount?: number | null
          cancel_refund_at?: string | null
          cancel_refund_mode?: string | null
          check_in: string
          check_out: string
          checkout_override_at?: string | null
          checkout_override_balance?: number | null
          checkout_override_by?: string | null
          checkout_override_reason?: string | null
          children?: number
          created_at?: string
          customer_id: string
          discount?: number
          draft_expires_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          expected_arrival_at?: string | null
          external_ref?: string | null
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          guest_name: string
          guests?: number
          id?: string
          integration_id?: string | null
          internal_notes?: string | null
          lead_id?: string | null
          lead_source?: string | null
          nights?: number | null
          notes?: string | null
          part_payment_type?: string
          part_payment_value?: number
          pay_at_hotel?: boolean
          payment_status?: string
          phone?: string | null
          room_details?: string | null
          room_id?: string | null
          source_channel?: string
          source_quote_id?: string | null
          special_requests?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal?: number
          tax_rate?: number
          taxes?: number
          taxes_included?: boolean
          total_override?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          adults?: number
          advance_paid?: number
          allow_full_payment?: boolean
          allow_part_payment?: boolean
          allow_pay_at_hotel?: boolean
          amount?: number
          booking_reference?: string
          cancel_reason?: string | null
          cancel_refund_amount?: number | null
          cancel_refund_at?: string | null
          cancel_refund_mode?: string | null
          check_in?: string
          check_out?: string
          checkout_override_at?: string | null
          checkout_override_balance?: number | null
          checkout_override_by?: string | null
          checkout_override_reason?: string | null
          children?: number
          created_at?: string
          customer_id?: string
          discount?: number
          draft_expires_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          expected_arrival_at?: string | null
          external_ref?: string | null
          gateway_order_id?: string | null
          gateway_payment_id?: string | null
          guest_name?: string
          guests?: number
          id?: string
          integration_id?: string | null
          internal_notes?: string | null
          lead_id?: string | null
          lead_source?: string | null
          nights?: number | null
          notes?: string | null
          part_payment_type?: string
          part_payment_value?: number
          pay_at_hotel?: boolean
          payment_status?: string
          phone?: string | null
          room_details?: string | null
          room_id?: string | null
          source_channel?: string
          source_quote_id?: string | null
          special_requests?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal?: number
          tax_rate?: number
          taxes?: number
          taxes_included?: boolean
          total_override?: number | null
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
            foreignKeyName: "bookings_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
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
      cash_audit_activities: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          audit_close_id: string | null
          closed_through_date: string | null
          created_at: string
          id: string
          reason: string | null
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          audit_close_id?: string | null
          closed_through_date?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          audit_close_id?: string | null
          closed_through_date?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_audit_activities_audit_close_id_fkey"
            columns: ["audit_close_id"]
            isOneToOne: false
            referencedRelation: "cash_audit_closes"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_audit_closes: {
        Row: {
          active: boolean
          closed_at: string
          closed_by: string | null
          closed_by_name: string | null
          closed_through_date: string
          created_at: string
          id: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          reopened_by_name: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          closed_at?: string
          closed_by?: string | null
          closed_by_name?: string | null
          closed_through_date: string
          created_at?: string
          id?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          reopened_by_name?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          closed_at?: string
          closed_by?: string | null
          closed_by_name?: string | null
          closed_through_date?: string
          created_at?: string
          id?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          reopened_by_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cash_transactions: {
        Row: {
          active: boolean
          amount: number
          booking_id: string | null
          booking_payment_id: string | null
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
          booking_payment_id?: string | null
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
          booking_payment_id?: string | null
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
      charge_catalog: {
        Row: {
          active: boolean
          auto_consume_qty: number
          created_at: string
          default_price: number
          id: string
          inventory_item_id: string | null
          key: string
          label: string
          sort_order: number
          taxable: boolean
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          auto_consume_qty?: number
          created_at?: string
          default_price?: number
          id?: string
          inventory_item_id?: string | null
          key: string
          label: string
          sort_order?: number
          taxable?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          auto_consume_qty?: number
          created_at?: string
          default_price?: number
          id?: string
          inventory_item_id?: string | null
          key?: string
          label?: string
          sort_order?: number
          taxable?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charge_catalog_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
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
          closed_at: string | null
          complaint_number: string
          complaint_type: Database["public"]["Enums"]["complaint_type"]
          created_at: string
          customer_id: string | null
          description: string
          entered_by_name: string | null
          entered_by_staff_id: string | null
          guest_impacted: boolean
          id: string
          issue_type: string | null
          priority: Database["public"]["Enums"]["complaint_priority"]
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by_name: string | null
          resolved_by_staff_id: string | null
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
          closed_at?: string | null
          complaint_number?: string
          complaint_type?: Database["public"]["Enums"]["complaint_type"]
          created_at?: string
          customer_id?: string | null
          description: string
          entered_by_name?: string | null
          entered_by_staff_id?: string | null
          guest_impacted?: boolean
          id?: string
          issue_type?: string | null
          priority?: Database["public"]["Enums"]["complaint_priority"]
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by_name?: string | null
          resolved_by_staff_id?: string | null
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
          closed_at?: string | null
          complaint_number?: string
          complaint_type?: Database["public"]["Enums"]["complaint_type"]
          created_at?: string
          customer_id?: string | null
          description?: string
          entered_by_name?: string | null
          entered_by_staff_id?: string | null
          guest_impacted?: boolean
          id?: string
          issue_type?: string | null
          priority?: Database["public"]["Enums"]["complaint_priority"]
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by_name?: string | null
          resolved_by_staff_id?: string | null
          room_number?: string | null
          status?: Database["public"]["Enums"]["complaint_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaints_resolved_by_staff_id_fkey"
            columns: ["resolved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_outbound_emails: {
        Row: {
          body_html: string | null
          body_text: string
          created_at: string
          error: string | null
          event: string
          id: string
          lead_id: string | null
          recipients: Json
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          body_html?: string | null
          body_text: string
          created_at?: string
          error?: string | null
          event: string
          id?: string
          lead_id?: string | null
          recipients?: Json
          sent_at?: string | null
          status?: string
          subject: string
        }
        Update: {
          body_html?: string | null
          body_text?: string
          created_at?: string
          error?: string | null
          event?: string
          id?: string
          lead_id?: string | null
          recipients?: Json
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_outbound_emails_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
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
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          first_contact_date: string
          first_lead_at: string | null
          gst_number: string | null
          guest_name: string
          guest_type: string | null
          id: string
          internal_notes: string | null
          last_stay_date: string | null
          lead_count: number
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
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_contact_date?: string
          first_lead_at?: string | null
          gst_number?: string | null
          guest_name: string
          guest_type?: string | null
          id?: string
          internal_notes?: string | null
          last_stay_date?: string | null
          lead_count?: number
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
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_contact_date?: string
          first_lead_at?: string | null
          gst_number?: string | null
          guest_name?: string
          guest_type?: string | null
          id?: string
          internal_notes?: string | null
          last_stay_date?: string | null
          lead_count?: number
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
      external_bookings: {
        Row: {
          booking_id: string | null
          created_at: string
          error_message: string | null
          external_ref: string
          id: string
          integration_id: string
          parsed: Json | null
          raw_payload: Json | null
          state: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          error_message?: string | null
          external_ref: string
          id?: string
          integration_id: string
          parsed?: Json | null
          raw_payload?: Json | null
          state?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          error_message?: string | null
          external_ref?: string
          id?: string
          integration_id?: string
          parsed?: Json | null
          raw_payload?: Json | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_bookings_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
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
      guest_documents: {
        Row: {
          back_path: string | null
          booking_id: string | null
          created_at: string
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_by_name: string | null
          doc_type: string
          expires_at: string | null
          front_path: string | null
          id: string
          notes: string | null
          selfie_path: string | null
          source: string | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          uploaded_by_name: string | null
          user_id: string
          verified_at: string | null
          verified_by_name: string | null
        }
        Insert: {
          back_path?: string | null
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_by_name?: string | null
          doc_type: string
          expires_at?: string | null
          front_path?: string | null
          id?: string
          notes?: string | null
          selfie_path?: string | null
          source?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          user_id?: string
          verified_at?: string | null
          verified_by_name?: string | null
        }
        Update: {
          back_path?: string | null
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_by_name?: string | null
          doc_type?: string
          expires_at?: string | null
          front_path?: string | null
          id?: string
          notes?: string | null
          selfie_path?: string | null
          source?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          user_id?: string
          verified_at?: string | null
          verified_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_reviews: {
        Row: {
          booking_id: string
          comment: string | null
          created_at: string
          customer_id: string | null
          feedback_additional_comments: string | null
          feedback_what_went_wrong: string | null
          guest_name: string | null
          id: string
          is_public: boolean
          moderated_at: string | null
          rating: number
          routed_to_external: boolean
          source: string | null
          updated_at: string
          would_recommend: boolean | null
        }
        Insert: {
          booking_id: string
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          feedback_additional_comments?: string | null
          feedback_what_went_wrong?: string | null
          guest_name?: string | null
          id?: string
          is_public?: boolean
          moderated_at?: string | null
          rating: number
          routed_to_external?: boolean
          source?: string | null
          updated_at?: string
          would_recommend?: boolean | null
        }
        Update: {
          booking_id?: string
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          feedback_additional_comments?: string | null
          feedback_what_went_wrong?: string | null
          guest_name?: string | null
          id?: string
          is_public?: boolean
          moderated_at?: string | null
          rating?: number
          routed_to_external?: boolean
          source?: string | null
          updated_at?: string
          would_recommend?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_runs: {
        Row: {
          created_count: number
          finished_at: string | null
          id: string
          integration_id: string
          message: string | null
          payload_excerpt: string | null
          started_at: string
          status: string
          updated_count: number
        }
        Insert: {
          created_count?: number
          finished_at?: string | null
          id?: string
          integration_id: string
          message?: string | null
          payload_excerpt?: string | null
          started_at?: string
          status?: string
          updated_count?: number
        }
        Update: {
          created_count?: number
          finished_at?: string | null
          id?: string
          integration_id?: string
          message?: string | null
          payload_excerpt?: string | null
          started_at?: string
          status?: string
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "integration_runs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          bookings_imported: number
          config: Json
          created_at: string
          id: string
          last_sync_at: string | null
          last_sync_message: string | null
          last_sync_status: string | null
          name: string
          provider: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          bookings_imported?: number
          config?: Json
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_message?: string | null
          last_sync_status?: string | null
          name: string
          provider: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          bookings_imported?: number
          config?: Json
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_message?: string | null
          last_sync_status?: string | null
          name?: string
          provider?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          active: boolean
          auto_consume_catalog_key: string | null
          category_value: string | null
          created_at: string
          current_stock: number
          housekeeping_per_room: number | null
          id: string
          minimum_stock: number
          name: string
          photo_path: string | null
          preferred_vendor_id: string | null
          unit: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          auto_consume_catalog_key?: string | null
          category_value?: string | null
          created_at?: string
          current_stock?: number
          housekeeping_per_room?: number | null
          id?: string
          minimum_stock?: number
          name: string
          photo_path?: string | null
          preferred_vendor_id?: string | null
          unit?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          auto_consume_catalog_key?: string | null
          category_value?: string | null
          created_at?: string
          current_stock?: number
          housekeeping_per_room?: number | null
          id?: string
          minimum_stock?: number
          name?: string
          photo_path?: string | null
          preferred_vendor_id?: string | null
          unit?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_auto_consume_catalog_key_fkey"
            columns: ["auto_consume_catalog_key"]
            isOneToOne: false
            referencedRelation: "charge_catalog"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "inventory_items_preferred_vendor_id_fkey"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          batch_id: string | null
          correlation_id: string | null
          created_at: string
          delta: number
          id: string
          item_id: string
          notes: string | null
          occurred_at: string
          reason: Database["public"]["Enums"]["inventory_movement_reason"]
          source_id: string | null
          source_type: string | null
          unit_cost: number | null
          user_id: string | null
          vendor_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          batch_id?: string | null
          correlation_id?: string | null
          created_at?: string
          delta: number
          id?: string
          item_id: string
          notes?: string | null
          occurred_at?: string
          reason: Database["public"]["Enums"]["inventory_movement_reason"]
          source_id?: string | null
          source_type?: string | null
          unit_cost?: number | null
          user_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          batch_id?: string | null
          correlation_id?: string | null
          created_at?: string
          delta?: number
          id?: string
          item_id?: string
          notes?: string | null
          occurred_at?: string
          reason?: Database["public"]["Enums"]["inventory_movement_reason"]
          source_id?: string | null
          source_type?: string | null
          unit_cost?: number | null
          user_id?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          created_at: string
          field: string | null
          id: string
          lead_id: string
          new_value: string | null
          old_value: string | null
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          field?: string | null
          id?: string
          lead_id: string
          new_value?: string | null
          old_value?: string | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          created_at?: string
          field?: string | null
          id?: string
          lead_id?: string
          new_value?: string | null
          old_value?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          abandoned_at: string | null
          adults: number | null
          booking_id: string | null
          check_in: string | null
          check_out: string | null
          children: number | null
          converted_at: string | null
          created_at: string
          customer_id: string | null
          email: string | null
          estimated_total: number | null
          guest_name: string
          id: string
          last_activity_at: string
          lost_at: string | null
          lost_reason: string | null
          notes: string | null
          phone: string
          room_type_id: string | null
          room_type_name: string | null
          rooms: number | null
          source_channel: string
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          abandoned_at?: string | null
          adults?: number | null
          booking_id?: string | null
          check_in?: string | null
          check_out?: string | null
          children?: number | null
          converted_at?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          estimated_total?: number | null
          guest_name: string
          id?: string
          last_activity_at?: string
          lost_at?: string | null
          lost_reason?: string | null
          notes?: string | null
          phone: string
          room_type_id?: string | null
          room_type_name?: string | null
          rooms?: number | null
          source_channel?: string
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          abandoned_at?: string | null
          adults?: number | null
          booking_id?: string | null
          check_in?: string | null
          check_out?: string | null
          children?: number | null
          converted_at?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          estimated_total?: number | null
          guest_name?: string
          id?: string
          last_activity_at?: string
          lost_at?: string | null
          lost_reason?: string | null
          notes?: string | null
          phone?: string
          room_type_id?: string | null
          room_type_name?: string | null
          rooms?: number | null
          source_channel?: string
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      master_data: {
        Row: {
          active: boolean
          category: string
          created_at: string
          id: string
          label: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          id?: string
          label: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      night_audit_decisions: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          after_status: string | null
          before_status: string | null
          booking_id: string | null
          business_date: string
          created_at: string
          id: string
          payload: Json
          reason: string | null
          session_id: string
          step: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after_status?: string | null
          before_status?: string | null
          booking_id?: string | null
          business_date: string
          created_at?: string
          id?: string
          payload?: Json
          reason?: string | null
          session_id: string
          step: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after_status?: string | null
          before_status?: string | null
          booking_id?: string | null
          business_date?: string
          created_at?: string
          id?: string
          payload?: Json
          reason?: string | null
          session_id?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "night_audit_decisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "night_audit_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      night_audit_runs: {
        Row: {
          actor_name: string | null
          created_at: string
          id: string
          mode: string
          new_business_date: string
          notes: string | null
          pending_check_ins_resolved: number
          pending_check_outs_resolved: number
          previous_business_date: string | null
          user_id: string | null
        }
        Insert: {
          actor_name?: string | null
          created_at?: string
          id?: string
          mode?: string
          new_business_date: string
          notes?: string | null
          pending_check_ins_resolved?: number
          pending_check_outs_resolved?: number
          previous_business_date?: string | null
          user_id?: string | null
        }
        Update: {
          actor_name?: string | null
          created_at?: string
          id?: string
          mode?: string
          new_business_date?: string
          notes?: string | null
          pending_check_ins_resolved?: number
          pending_check_outs_resolved?: number
          previous_business_date?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      night_audit_sessions: {
        Row: {
          business_date: string
          closed_at: string | null
          closed_by_id: string | null
          closed_by_name: string | null
          created_at: string
          eod_html: string | null
          id: string
          opened_at: string
          opened_by_id: string | null
          opened_by_name: string | null
          reopen_reason: string | null
          status: string
          totals: Json
          updated_at: string
        }
        Insert: {
          business_date: string
          closed_at?: string | null
          closed_by_id?: string | null
          closed_by_name?: string | null
          created_at?: string
          eod_html?: string | null
          id?: string
          opened_at?: string
          opened_by_id?: string | null
          opened_by_name?: string | null
          reopen_reason?: string | null
          status?: string
          totals?: Json
          updated_at?: string
        }
        Update: {
          business_date?: string
          closed_at?: string | null
          closed_by_id?: string | null
          closed_by_name?: string | null
          created_at?: string
          eod_html?: string | null
          id?: string
          opened_at?: string
          opened_by_id?: string | null
          opened_by_name?: string | null
          reopen_reason?: string | null
          status?: string
          totals?: Json
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          audience_role: string | null
          body: string
          created_at: string
          entity_id: string | null
          entity_reference: string | null
          entity_type: string | null
          id: string
          metadata: Json
          priority: string
          read_at: string | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          audience_role?: string | null
          body: string
          created_at?: string
          entity_id?: string | null
          entity_reference?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          priority?: string
          read_at?: string | null
          status?: string
          title: string
          type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          audience_role?: string | null
          body?: string
          created_at?: string
          entity_id?: string | null
          entity_reference?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
          priority?: string
          read_at?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          label: string
          module: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          label: string
          module: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          label?: string
          module?: string
          sort_order?: number
        }
        Relationships: []
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
      promo_codes: {
        Row: {
          active: boolean
          applicable_room_types: string[] | null
          applies_to: string
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          discount_type: string
          discount_value: number
          id: string
          max_uses: number | null
          min_nights: number | null
          season_label: string | null
          updated_at: string
          used_count: number
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          applicable_room_types?: string[] | null
          applies_to?: string
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_type: string
          discount_value: number
          id?: string
          max_uses?: number | null
          min_nights?: number | null
          season_label?: string | null
          updated_at?: string
          used_count?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          applicable_room_types?: string[] | null
          applies_to?: string
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          max_uses?: number | null
          min_nights?: number | null
          season_label?: string | null
          updated_at?: string
          used_count?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          audience_role: string | null
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          audience_role?: string | null
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          audience_role?: string | null
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string | null
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
          taxes_included: boolean
          total: number
          total_override: number | null
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
          taxes_included?: boolean
          total?: number
          total_override?: number | null
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
          taxes_included?: boolean
          total?: number
          total_override?: number | null
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
      rate_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          note: string | null
          rate: number
          room_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          note?: string | null
          rate: number
          room_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          note?: string | null
          rate?: number
          room_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_key: string
          role_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_key: string
          role_key: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_key?: string
          role_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      room_maintenance: {
        Row: {
          active: boolean
          blocked_at: string
          blocked_by: string | null
          created_at: string
          end_date: string
          id: string
          reason: string | null
          room_id: string
          start_date: string
          unblocked_at: string | null
          unblocked_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          blocked_at?: string
          blocked_by?: string | null
          created_at?: string
          end_date: string
          id?: string
          reason?: string | null
          room_id: string
          start_date: string
          unblocked_at?: string | null
          unblocked_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          blocked_at?: string
          blocked_by?: string | null
          created_at?: string
          end_date?: string
          id?: string
          reason?: string | null
          room_id?: string
          start_date?: string
          unblocked_at?: string | null
          unblocked_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_maintenance_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_rates: {
        Row: {
          default_rate: number
          room_type: string
          updated_at: string
          updated_by: string | null
          weekday_rate: number | null
          weekend_rate: number | null
        }
        Insert: {
          default_rate?: number
          room_type: string
          updated_at?: string
          updated_by?: string | null
          weekday_rate?: number | null
          weekend_rate?: number | null
        }
        Update: {
          default_rate?: number
          room_type?: string
          updated_at?: string
          updated_by?: string | null
          weekday_rate?: number | null
          weekend_rate?: number | null
        }
        Relationships: []
      }
      rooms: {
        Row: {
          active: boolean
          created_at: string
          floor: number
          id: string
          notes: string | null
          room_number: string
          room_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          floor: number
          id?: string
          notes?: string | null
          room_number: string
          room_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          floor?: number
          id?: string
          notes?: string | null
          room_number?: string
          room_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      salary_advances: {
        Row: {
          advance_date: string
          amount: number
          created_at: string
          id: string
          notes: string | null
          recovered_in_month: string | null
          staff_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          advance_date?: string
          amount: number
          created_at?: string
          id?: string
          notes?: string | null
          recovered_in_month?: string | null
          staff_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          advance_date?: string
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          recovered_in_month?: string | null
          staff_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_advances_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_payments: {
        Row: {
          absent_days: number
          absent_deduction: number
          advance_recovery: number
          bonus: number
          created_at: string
          gross: number
          halfday_count: number
          halfday_deduction: number
          id: string
          incentives: number
          leave_days: number
          month: string
          net: number
          notes: string | null
          other_deductions: number
          paid_amount: number
          paid_at: string | null
          payment_mode: string | null
          present_days: number
          salary_period_from: string | null
          salary_period_to: string | null
          staff_id: string
          status: string
          updated_at: string
          user_id: string
          working_days_basis: string
        }
        Insert: {
          absent_days?: number
          absent_deduction?: number
          advance_recovery?: number
          bonus?: number
          created_at?: string
          gross?: number
          halfday_count?: number
          halfday_deduction?: number
          id?: string
          incentives?: number
          leave_days?: number
          month: string
          net?: number
          notes?: string | null
          other_deductions?: number
          paid_amount?: number
          paid_at?: string | null
          payment_mode?: string | null
          present_days?: number
          salary_period_from?: string | null
          salary_period_to?: string | null
          staff_id: string
          status?: string
          updated_at?: string
          user_id: string
          working_days_basis?: string
        }
        Update: {
          absent_days?: number
          absent_deduction?: number
          advance_recovery?: number
          bonus?: number
          created_at?: string
          gross?: number
          halfday_count?: number
          halfday_deduction?: number
          id?: string
          incentives?: number
          leave_days?: number
          month?: string
          net?: number
          notes?: string | null
          other_deductions?: number
          paid_amount?: number
          paid_at?: string | null
          payment_mode?: string | null
          present_days?: number
          salary_period_from?: string | null
          salary_period_to?: string | null
          staff_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          working_days_basis?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          accommodation_provided: boolean
          active: boolean
          available_in_cashbook: boolean
          available_in_complaints: boolean
          available_in_dues: boolean
          basic_salary: number | null
          created_at: string
          date_of_joining: string | null
          department: string | null
          designation: string | null
          employee_code: string | null
          food_provided: boolean
          id: string
          mobile: string | null
          monthly_salary: number | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accommodation_provided?: boolean
          active?: boolean
          available_in_cashbook?: boolean
          available_in_complaints?: boolean
          available_in_dues?: boolean
          basic_salary?: number | null
          created_at?: string
          date_of_joining?: string | null
          department?: string | null
          designation?: string | null
          employee_code?: string | null
          food_provided?: boolean
          id?: string
          mobile?: string | null
          monthly_salary?: number | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accommodation_provided?: boolean
          active?: boolean
          available_in_cashbook?: boolean
          available_in_complaints?: boolean
          available_in_dues?: boolean
          basic_salary?: number | null
          created_at?: string
          date_of_joining?: string | null
          department?: string | null
          designation?: string | null
          employee_code?: string | null
          food_provided?: boolean
          id?: string
          mobile?: string | null
          monthly_salary?: number | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_attendance: {
        Row: {
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          date: string
          id: string
          notes: string | null
          staff_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          staff_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          staff_id?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_documents: {
        Row: {
          created_at: string
          doc_type: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          notes: string | null
          staff_id: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          created_at?: string
          doc_type: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          staff_id: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          staff_id?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_documents_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
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
      user_permission_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          granted: boolean
          id: string
          notes: string | null
          permission_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          granted: boolean
          id?: string
          notes?: string | null
          permission_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          granted?: boolean
          id?: string
          notes?: string | null
          permission_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
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
      vendors: {
        Row: {
          active: boolean
          address: string | null
          alt_phones: string[]
          contact_person: string
          created_at: string
          id: string
          maps_url: string | null
          name: string
          notes: string | null
          phone: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          alt_phones?: string[]
          contact_person: string
          created_at?: string
          id?: string
          maps_url?: string | null
          name: string
          notes?: string | null
          phone: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          alt_phones?: string[]
          contact_person?: string
          created_at?: string
          id?: string
          maps_url?: string | null
          name?: string
          notes?: string | null
          phone?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_guest_documents: { Args: never; Returns: number }
      current_actor: {
        Args: never
        Returns: {
          display_name: string
          role: string
          uid: string
        }[]
      }
      expire_guest_documents_for_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      has_permission: {
        Args: { _permission_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_cash_tx_locked: { Args: { p_occurred_at: string }; Returns: boolean }
      log_activity: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_correlation_id?: string
          p_entity_id?: string
          p_entity_reference?: string
          p_entity_type?: string
          p_metadata?: Json
          p_page: string
          p_property_id?: string
          p_source?: string
          p_summary?: string
        }
        Returns: string
      }
      my_permissions: { Args: never; Returns: string[] }
      normalize_phone_in: { Args: { p: string }; Returns: string }
      recompute_booking_advance: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      recompute_customer_bookings: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      recompute_customer_stats: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      recompute_inventory_stock: {
        Args: { p_item_id: string }
        Returns: number
      }
      sweep_abandoned_leads: { Args: never; Returns: number }
      sweep_expired_draft_bookings: { Args: never; Returns: number }
      sweep_lost_leads: { Args: never; Returns: number }
      sweep_stay_completed: { Args: never; Returns: number }
      sync_inventory_for_charge: {
        Args: { p_charge_id: string }
        Returns: undefined
      }
      user_effective_permissions: {
        Args: { _user_id: string }
        Returns: {
          permission_key: string
          source: string
        }[]
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
      app_role: "admin" | "staff" | "owner" | "reception"
      attendance_status: "Present" | "Absent" | "HalfDay" | "Leave"
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
        | "No-Show"
      complaint_priority: "Low" | "Medium" | "High" | "Critical"
      complaint_status: "Open" | "In Progress" | "Resolved"
      complaint_type: "Room" | "General"
      inventory_movement_reason:
        | "stock_in"
        | "stock_out"
        | "auto_charge"
        | "auto_housekeeping"
        | "reconciliation_adjust"
        | "wastage"
        | "correction"
      lead_status: "Interested" | "Abandoned" | "Converted" | "Lost"
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
      app_role: ["admin", "staff", "owner", "reception"],
      attendance_status: ["Present", "Absent", "HalfDay", "Leave"],
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
        "No-Show",
      ],
      complaint_priority: ["Low", "Medium", "High", "Critical"],
      complaint_status: ["Open", "In Progress", "Resolved"],
      complaint_type: ["Room", "General"],
      inventory_movement_reason: [
        "stock_in",
        "stock_out",
        "auto_charge",
        "auto_housekeeping",
        "reconciliation_adjust",
        "wastage",
        "correction",
      ],
      lead_status: ["Interested", "Abandoned", "Converted", "Lost"],
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
