using MCPService from '../../srv/mcp-service';

extend service MCPService with {
    @description: 'This is a test action which is only there if feature toggle is enabled'
    action myToggledAction(identifier: String) returns String;

    @odata.draft.enabled
    @description: 'A draft-enabled entity only available with isbn feature toggle'
    entity ToggledBooks {
        key ID : UUID;
        title  : String(100);
        isbn   : String(13);
    }
}
