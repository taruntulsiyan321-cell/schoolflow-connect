-- Run this ALONE first (separate query), then fresh-batch-02b.sql
-- PostgreSQL requires new enum values to commit before use.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'principal';
