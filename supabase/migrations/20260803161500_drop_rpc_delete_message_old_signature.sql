-- Migration 20260803162000_gurukul_chat_security.sql redefines
-- rpc_delete_message to RETURN public.messages, but 20260803160000
-- originally created it returning boolean. PostgreSQL's CREATE OR REPLACE
-- FUNCTION cannot change a function's return type ("cannot change return
-- type of existing function"), so 20260803162000's own CREATE OR REPLACE
-- fails as written. Dropping the old boolean-returning signature here so
-- 20260803162000's CREATE OR REPLACE succeeds as a fresh definition.
DROP FUNCTION IF EXISTS public.rpc_delete_message(uuid);
