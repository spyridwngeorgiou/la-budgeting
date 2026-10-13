begin;
select plan(4);
select has_column('public', 'property_utilities', 'monthly_amount', 'monthly_amount exists');
select has_column('public', 'property_utilities', 'billing_frequency', 'billing_frequency exists');
select col_is_null('public', 'property_utilities', 'monthly_amount', 'monthly_amount is optional');
select col_has_check('public', 'property_utilities', 'monthly_amount', 'monthly_amount has a non-negative check');
select * from finish();
rollback;
