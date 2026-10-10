-- 0082: new enum values for agent_changes v2 (0083), in their own migration
-- because a value added by ALTER TYPE ... ADD VALUE can't be used in the
-- transaction that adds it.
--
--   conflict  the row changed since the proposal in a field it touches;
--             the reviewer sees both values and may approve anyway
--   failed    the database refused the change when it was approved
--   action    a multi-step proposal executed by apply_agent_change()
--             (agent_changes.action, e.g. create_revenue_plan)

alter type agent_change_status add value if not exists 'conflict';
alter type agent_change_status add value if not exists 'failed';
alter type agent_change_op add value if not exists 'action';
