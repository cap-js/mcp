service NestedSchemaService {
    type Factor {
        @mandatory category: String enum { ClimateChange = 'CLCH'; };
        value: Decimal @mandatory @assert.range: [0, 100] @description: 'Factor value';
        unit: String @assert.format: '^[A-Z]{2,3}$';
        comment: String;
    };

    action apply(
        @mandatory entries: many { @mandatory factors: many Factor; },
        settings: { category: String enum { ClimateChange = 'CLCH'; }; },
        category: String enum { ClimateChange = 'CLCH'; }
    );
}
