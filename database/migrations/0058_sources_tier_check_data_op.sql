-- 金融站新增 T_DATA（官方统计发布，权威性等同 T1）与 T2_OP（观点类媒体）两个分级。
-- 做法：先把新约束作为独立的 NOT VALID 约束加上（加约束不重验既有行），
-- 再由 0059 验证，最后由 0060 移除只认识旧分级的 0001 约束。
-- 不用 DROP CONSTRAINT 直接改，因为那会重验全表持有强锁，在线迁移检查会拒绝。
ALTER TABLE sources ADD CONSTRAINT sources_tier_check_v2 CHECK (tier IN ('T1', 'T1_5', 'T_DATA', 'T2', 'T2_OP', 'EXCLUDE_MP')) NOT VALID;
