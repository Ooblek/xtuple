-- add uuid column here because there are views that need this
select xt.add_column('cohead','obj_uuid', 'text', 'default xt.generate_uuid()', 'public');
select xt.add_inheritance('cohead', 'xt.obj');
select xt.add_constraint('cohead', 'cohead_obj_uuid','unique(obj_uuid)', 'public');
