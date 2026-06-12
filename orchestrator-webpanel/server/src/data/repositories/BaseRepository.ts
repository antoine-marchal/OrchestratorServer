import { getCollection, ICollection, FindOptions } from '../db/index';

// Typed data-access wrapper over one collection. Mirrors the ICollection
// surface 1:1 so call sites read the same, but hides the string collection key
// behind a named repository and returns typed entities. The collection is
// resolved lazily per call (getCollection throws until connectDB() has run),
// so repository singletons can be constructed at module load time.
//
// Reads return `T` (entity models are declared `Model & Record<string, any>` by
// subclasses, so known fields are typed while dynamic/legacy fields stay
// accessible). Writes accept `any` — insert/update payloads are validated at the
// service layer, not here.
export class BaseRepository<T = any> {
  constructor(protected readonly name: string) {}

  protected get collection(): ICollection {
    return getCollection(this.name);
  }

  find(query: object = {}, options?: FindOptions): Promise<T[]> {
    return this.collection.find(query, options);
  }

  findOne(query: object): Promise<T | null> {
    return this.collection.findOne(query);
  }

  findById(id: string): Promise<T | null> {
    return this.collection.findOne({ _id: id });
  }

  insert(doc: any): Promise<T> {
    return this.collection.insert(doc);
  }

  update(query: object, update: object, options?: { multi?: boolean; [k: string]: any }): Promise<number> {
    return this.collection.update(query, update, options);
  }

  updateById(id: string, update: object): Promise<number> {
    return this.collection.update({ _id: id }, update);
  }

  remove(query: object, options?: { multi?: boolean; [k: string]: any }): Promise<number> {
    return this.collection.remove(query, options);
  }

  removeById(id: string): Promise<number> {
    return this.collection.remove({ _id: id });
  }

  count(query: object = {}): Promise<number> {
    return this.collection.count(query);
  }
}
