using CatalogService from './cat-service';

extend service CatalogService {
    @description : 'Testing many in actions for ZOD schema'
    action withMany(updates: many {ID: String}) returns many {ID: String};

    type prop1: String;
    type props {
        ID: String;
        abc: String;
        def: DateTime;
        prop1: prop1;
    };
    @description : 'Testing many in combination with custom types in actions for ZOD schema'
    action withManyCustomTypes(updates: many props) returns many props;

    @description : 'Testing custom types in actions for ZOD schema'
    action withCustomTypes(prop1: prop1) returns props;

    /** Testing array of scalar and array of struct parameters */
    action withArrayParams(
      /** A many String parameter */
      manyStringParam: many String,
      /** An array of String parameter */
      arrayOfStringParam: array of String,
      /** A many inline struct parameter */
      manyStructParam: many { name: String; value: Integer },
      /** A many custom type parameter */
      customTypeParam: many props
    ) returns String;
}
