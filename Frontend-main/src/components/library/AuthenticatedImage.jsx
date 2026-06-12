import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import {
  fetchAuthenticatedAssetBlobUrl,
  isProtectedPublicAsset,
  sanitizeAssetUrl,
} from '../../utils/common/artifactUrlUtils';

const AuthenticatedImage = ({
  src,
  alt = '',
  className,
  onError,
  onLoad,
  ...rest
}) => {
  const [displaySrc, setDisplaySrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDisplaySrc(null);

    const sanitized = sanitizeAssetUrl(src);
    if (!sanitized) {
      setFailed(true);
      return undefined;
    }

    if (!isProtectedPublicAsset(sanitized)) {
      setDisplaySrc(sanitized);
      return undefined;
    }

    fetchAuthenticatedAssetBlobUrl(sanitized).then((blobUrl) => {
      if (cancelled) return;
      if (blobUrl) {
        setDisplaySrc(blobUrl);
      } else {
        setFailed(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (failed && onError) onError();
  }, [failed, onError]);

  if (failed || !displaySrc) {
    return null;
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      onError={onError}
      onLoad={onLoad}
      {...rest}
    />
  );
};

AuthenticatedImage.propTypes = {
  src: PropTypes.string,
  alt: PropTypes.string,
  className: PropTypes.string,
  onError: PropTypes.func,
  onLoad: PropTypes.func,
};

export default AuthenticatedImage;
