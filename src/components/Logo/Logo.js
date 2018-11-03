import React from 'react';
import './styles.css';

const logoTitle = "ReactBoy";

class Logo extends React.Component {
  constructor (props) {
    super(props);
    return ;
  }
  render () {
    return (
      <React.Fragment>
        <div id="reactboy-logo">{ logoTitle }</div>
      </React.Fragment>
    );
  }
}

export default Logo;
