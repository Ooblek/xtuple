-- Migrate custgrp table from standalone to inherited from `groups` base table

DO $$
BEGIN
  IF EXISTS (SELECT 1
    FROM information_schema.columns c
    JOIN information_schema.tables t ON c.table_name=t.table_name
    WHERE t.table_name = 'custgrpitem'
    AND column_name =  'custgrpitem_id') 
  THEN
    DROP TABLE IF EXISTS tempgrpitem;
    PERFORM xt.create_table('tempgrpitem', 'public', false, 'groupsitem');

    ALTER TABLE public.custgrpitem DROP COLUMN IF EXISTS obj_uuid CASCADE;

    INSERT INTO tempgrpitem SELECT * FROM custgrpitem;

    DROP TABLE custgrpitem;
    ALTER TABLE tempgrpitem RENAME TO custgrpitem;
  END IF;

  PERFORM
    xt.add_constraint('custgrpitem', 'custgrpitem_pkey', 'PRIMARY KEY (groupsitem_id)', 'public'),
    xt.add_constraint('custgrpitem', 'custgrpitem_cust_id_fk', 'FOREIGN KEY (groupsitem_reference_id) REFERENCES custinfo(cust_id)', 'public'),
    xt.add_constraint('custgrpitem', 'custgrpitem_groups_fkey', $_$FOREIGN KEY (groupsitem_groups_id) 
                                            REFERENCES public.custgrp (groups_id) MATCH SIMPLE
                                            ON UPDATE NO ACTION ON DELETE CASCADE$_$, 'public');

  COMMENT ON TABLE public.custgrpitem IS 'Customer Group Item information';
END; $$;
