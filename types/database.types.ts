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
      admin_otp_codes: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_otp_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admins: {
        Row: {
          user_id: string
        }
        Insert: {
          user_id: string
        }
        Update: {
          user_id?: string
        }
        Relationships: []
      }
      cache_metrics: {
        Row: {
          date: string
          estimated_bytes_saved: number
          estimated_bytes_spent: number
          hits: number
          id: string
          misses: number
          route: string
        }
        Insert: {
          date?: string
          estimated_bytes_saved?: number
          estimated_bytes_spent?: number
          hits?: number
          id?: string
          misses?: number
          route: string
        }
        Update: {
          date?: string
          estimated_bytes_saved?: number
          estimated_bytes_spent?: number
          hits?: number
          id?: string
          misses?: number
          route?: string
        }
        Relationships: []
      }
      complaint_media: {
        Row: {
          complaint_id: string
          created_at: string
          display_order: number
          id: string
          kind: string
          storage_path: string
        }
        Insert: {
          complaint_id: string
          created_at?: string
          display_order?: number
          id?: string
          kind: string
          storage_path: string
        }
        Update: {
          complaint_id?: string
          created_at?: string
          display_order?: number
          id?: string
          kind?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaint_media_complaint_id_fkey"
            columns: ["complaint_id"]
            isOneToOne: false
            referencedRelation: "complaints"
            referencedColumns: ["id"]
          },
        ]
      }
      complaints: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          description: string
          expires_at: string
          id: string
          is_expired: boolean
          location: string | null
          reference_link: string | null
          status: string
          title: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description: string
          expires_at: string
          id?: string
          is_expired?: boolean
          location?: string | null
          reference_link?: string | null
          status?: string
          title?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string
          expires_at?: string
          id?: string
          is_expired?: boolean
          location?: string | null
          reference_link?: string | null
          status?: string
          title?: string | null
        }
        Relationships: []
      }
      cta_buttons: {
        Row: {
          color: string | null
          created_at: string
          display_order: number
          id: string
          label: string
          url: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          display_order?: number
          id?: string
          label: string
          url: string
        }
        Update: {
          color?: string | null
          created_at?: string
          display_order?: number
          id?: string
          label?: string
          url?: string
        }
        Relationships: []
      }
      dashboard_activity_logs: {
        Row: {
          action: string
          created_at: string
          details: string
          entity_id: string | null
          entity_type: string
          id: string
          user_email: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details: string
          entity_id?: string | null
          entity_type: string
          id?: string
          user_email: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_email?: string
          user_id?: string | null
        }
        Relationships: []
      }
      feature_media: {
        Row: {
          caption: string | null
          created_at: string
          display_order: number
          feature_id: string
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          public_url: string
          storage_path: string
          title: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          display_order?: number
          feature_id: string
          id?: string
          kind: Database["public"]["Enums"]["media_kind"]
          public_url: string
          storage_path: string
          title?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          display_order?: number
          feature_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          public_url?: string
          storage_path?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_media_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          body_markdown: string | null
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_published: boolean
          slideshow_interval: number
          subtitle: string | null
          title: string
          type: Database["public"]["Enums"]["feature_type"]
          updated_at: string
        }
        Insert: {
          body_markdown?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_published?: boolean
          slideshow_interval?: number
          subtitle?: string | null
          title: string
          type: Database["public"]["Enums"]["feature_type"]
          updated_at?: string
        }
        Update: {
          body_markdown?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_published?: boolean
          slideshow_interval?: number
          subtitle?: string | null
          title?: string
          type?: Database["public"]["Enums"]["feature_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "features_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      footer_blocks: {
        Row: {
          body: string | null
          created_at: string
          display_order: number
          id: string
          title: string | null
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          display_order?: number
          id?: string
          title?: string | null
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          display_order?: number
          id?: string
          title?: string | null
          type?: string
        }
        Relationships: []
      }
      footer_links: {
        Row: {
          created_at: string
          display_order: number
          footer_block_id: string
          id: string
          label: string
          url: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          footer_block_id: string
          id?: string
          label: string
          url: string
        }
        Update: {
          created_at?: string
          display_order?: number
          footer_block_id?: string
          id?: string
          label?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "footer_links_footer_block_id_fkey"
            columns: ["footer_block_id"]
            isOneToOne: false
            referencedRelation: "footer_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      header_actions: {
        Row: {
          bg_color: string | null
          created_at: string
          display_order: number
          icon: string
          id: string
          is_visible: boolean
          label: string
          position: string
          style: string
          text_color: string | null
          url: string
        }
        Insert: {
          bg_color?: string | null
          created_at?: string
          display_order?: number
          icon?: string
          id?: string
          is_visible?: boolean
          label?: string
          position?: string
          style?: string
          text_color?: string | null
          url: string
        }
        Update: {
          bg_color?: string | null
          created_at?: string
          display_order?: number
          icon?: string
          id?: string
          is_visible?: boolean
          label?: string
          position?: string
          style?: string
          text_color?: string | null
          url?: string
        }
        Relationships: []
      }
      nav_links: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_visible: boolean
          label: string
          url: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          label: string
          url: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          label?: string
          url?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          designation: string | null
          display_order: number
          external_url: string | null
          id: string
          logo_path: string
          logo_url: string
          name: string
        }
        Insert: {
          created_at?: string
          designation?: string | null
          display_order?: number
          external_url?: string | null
          id?: string
          logo_path: string
          logo_url: string
          name: string
        }
        Update: {
          created_at?: string
          designation?: string | null
          display_order?: number
          external_url?: string | null
          id?: string
          logo_path?: string
          logo_url?: string
          name?: string
        }
        Relationships: []
      }
      phases: {
        Row: {
          created_at: string
          full_content: string | null
          id: string
          is_published: boolean
          max_display_images: number
          period: string | null
          photos: Json
          slideshow_interval: number
          sort_order: number
          summary: string
          title: string
        }
        Insert: {
          created_at?: string
          full_content?: string | null
          id?: string
          is_published?: boolean
          max_display_images?: number
          period?: string | null
          photos?: Json
          slideshow_interval?: number
          sort_order?: number
          summary: string
          title: string
        }
        Update: {
          created_at?: string
          full_content?: string | null
          id?: string
          is_published?: boolean
          max_display_images?: number
          period?: string | null
          photos?: Json
          slideshow_interval?: number
          sort_order?: number
          summary?: string
          title?: string
        }
        Relationships: []
      }
      post_media: {
        Row: {
          created_at: string
          display_order: number
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          post_id: string
          public_url: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          kind: Database["public"]["Enums"]["media_kind"]
          post_id: string
          public_url: string
          storage_path: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          post_id?: string
          public_url?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          id: string
          is_pinned: boolean
          is_published: boolean
          links: Json
          published_at: string
          slideshow_interval: number
          thumbnail_path: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          is_published?: boolean
          links?: Json
          published_at?: string
          slideshow_interval?: number
          thumbnail_path?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          is_published?: boolean
          links?: Json
          published_at?: string
          slideshow_interval?: number
          thumbnail_path?: string | null
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          admin_flag: boolean | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_admin: boolean
          phone: string | null
          role: string | null
        }
        Insert: {
          admin_flag?: boolean | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_admin?: boolean
          phone?: string | null
          role?: string | null
        }
        Update: {
          admin_flag?: boolean | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_admin?: boolean
          phone?: string | null
          role?: string | null
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          avatar_path: string | null
          avatar_url: string | null
          complaint_expiration_days: number
          footer_copyright_name: string | null
          footer_note: string | null
          footer_tagline: string | null
          gallery_interval_ms: number
          header_name: string | null
          header_subtitle: string | null
          hero_badge_subtitle: string | null
          hero_badge_title: string | null
          hero_body: string | null
          hero_cta_label: string | null
          hero_cta_url: string | null
          hero_eyebrow: string | null
          hero_headline: string | null
          hero_image_path: string | null
          hero_image_url: string | null
          homepage_layout: Json | null
          id: string
          notable_works_limit: number
          office_address: string | null
          office_email: string | null
          office_hours_enabled: boolean
          office_hours_text: string | null
          org_max_per_row: number
          show_organizations_section: boolean
          show_phases_section: boolean
          show_posts_feed_section: boolean
          theme_primary_color: string
          theme_secondary_color: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          avatar_url?: string | null
          complaint_expiration_days?: number
          footer_copyright_name?: string | null
          footer_note?: string | null
          footer_tagline?: string | null
          gallery_interval_ms?: number
          header_name?: string | null
          header_subtitle?: string | null
          hero_badge_subtitle?: string | null
          hero_badge_title?: string | null
          hero_body?: string | null
          hero_cta_label?: string | null
          hero_cta_url?: string | null
          hero_eyebrow?: string | null
          hero_headline?: string | null
          hero_image_path?: string | null
          hero_image_url?: string | null
          homepage_layout?: Json | null
          id?: string
          notable_works_limit?: number
          office_address?: string | null
          office_email?: string | null
          office_hours_enabled?: boolean
          office_hours_text?: string | null
          org_max_per_row?: number
          show_organizations_section?: boolean
          show_phases_section?: boolean
          show_posts_feed_section?: boolean
          theme_primary_color?: string
          theme_secondary_color?: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          avatar_url?: string | null
          complaint_expiration_days?: number
          footer_copyright_name?: string | null
          footer_note?: string | null
          footer_tagline?: string | null
          gallery_interval_ms?: number
          header_name?: string | null
          header_subtitle?: string | null
          hero_badge_subtitle?: string | null
          hero_badge_title?: string | null
          hero_body?: string | null
          hero_cta_label?: string | null
          hero_cta_url?: string | null
          hero_eyebrow?: string | null
          hero_headline?: string | null
          hero_image_path?: string | null
          hero_image_url?: string | null
          homepage_layout?: Json | null
          id?: string
          notable_works_limit?: number
          office_address?: string | null
          office_email?: string | null
          office_hours_enabled?: boolean
          office_hours_text?: string | null
          org_max_per_row?: number
          show_organizations_section?: boolean
          show_phases_section?: boolean
          show_posts_feed_section?: boolean
          theme_primary_color?: string
          theme_secondary_color?: string
          updated_at?: string
        }
        Relationships: []
      }
      social_links: {
        Row: {
          created_at: string
          display_order: number
          id: string
          label: string | null
          platform: string
          url: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          label?: string | null
          platform?: string
          url: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          label?: string | null
          platform?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      record_cache_event: {
        Args: { p_bytes: number; p_is_hit: boolean; p_route: string }
        Returns: undefined
      }
      transfer_admin_role: {
        Args: { new_admin_id: string }
        Returns: undefined
      }
    }
    Enums: {
      feature_type: "about" | "public_life_gallery" | "stats" | "custom_section"
      media_kind: "image" | "video"
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
  public: {
    Enums: {
      feature_type: ["about", "public_life_gallery", "stats", "custom_section"],
      media_kind: ["image", "video"],
    },
  },
} as const
