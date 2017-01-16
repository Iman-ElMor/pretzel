import attr from 'ember-data/attr';
import Fragment from 'model-fragments/fragment';

export default Fragment.extend({
  name: attr('string'),
  position: attr('number'),

});
