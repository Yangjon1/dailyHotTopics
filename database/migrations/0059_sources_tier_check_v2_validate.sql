-- 验证新约束。sources 行数极小（十几个信源），全表扫描无成本。
-- 若此处报出既有行违反新分级，说明历史数据用了未登记的 tier，需先修数据。
ALTER TABLE sources VALIDATE CONSTRAINT sources_tier_check_v2;
