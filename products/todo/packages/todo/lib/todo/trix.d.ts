/**
 * Trix ships no types.
 *
 * Nothing here reads the module's exports: the import is for its side
 * effect, which is registering the `<trix-editor>` custom element. The
 * editor object is reached through the element, and TrixNotesEditor
 * describes the part of it that it uses.
 */
declare module "trix";
