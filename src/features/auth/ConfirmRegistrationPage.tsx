import { Loader, Typography } from '@components/UI';
import Logo from '@components/UI/Decorators/Event-Rulers/Logo';
import { useConfirmRegistrationQuery } from '@features/auth/api/auth.api';
import { useLandscape, useMobile } from '@hooks/index';
import { snackbarAction } from '@store/slices/snackbarReducer';
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';

import classes from './style.module.scss';

export const ConfirmRegistrationPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { token } = useParams<{ token: string }>();

  const isMobile = useMobile();
  const isLandscape = useLandscape();

  const { data, error, isLoading } = useConfirmRegistrationQuery(token!, {
    skip: !token,
  });

  const [timeLeft, setTimeLeft] = useState(10);

  useEffect(() => {
    // Jeśli czas się skończył, nie robimy nic
    if (timeLeft === 0) return navigate('/admin/auth/login');

    // Ustawienie interwału, który zmniejsza czas co sekundę
    let intervalId: any;
    if (data?.status === 'SUCCESS') {
      intervalId = setInterval(() => {
        setTimeLeft(timeLeft - 1);
      }, 1000);
    }

    return () => {
      return clearInterval(intervalId);
    };
  }, [timeLeft, data]);

  useEffect(() => {
    if (data?.message) {
      dispatch(
        snackbarAction({
          status: 'SUCCESS',
          message: data.message,
        })
      );
    }

    if (error && 'data' in error) {
      const err = error as any;
      dispatch(
        snackbarAction({
          status: 'ERROR',
          message: err.data?.message || 'Nie udało się aktywować konta.',
        })
      );
      navigate('/');
    }
  }, [data, error]);

  return (
    <article className={classes.login}>
      <div className={classes.background} />
      <div
        className={classes.content}
        style={{
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className={classes['login__logo']}>
          <Logo
            onClick={() => {
              return navigate('/');
            }}
            duration={0.5}
            delay={0.2}
            height={isMobile ? (isLandscape ? 80 : 160) : 300}
            width={300}
            color="--main-gold"
            aria-label="logo"
          />
        </div>
        {isLoading ? (
          <Loader fullWidth />
        ) : (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '24px',
            }}
          >
            <Typography
              size="xx-large"
              color="--main-gold"
              fontFamily="barlow-bold"
            >
              {data?.message}
            </Typography>
            {data?.status === 'SUCCESS' && (
              <Typography
                size="large"
                align="center"
                color="--main-gold"
                fontFamily="barlow-bold"
              >
                Zaraz zostaniesz przekierowany na stronę logowania.
              </Typography>
            )}
            <Typography
              color="--white-shadow"
              component="p"
              size="medium"
              align="center"
              fontFamily="barlow-italic"
            >
              {timeLeft} s
            </Typography>
          </div>
        )}
      </div>
    </article>
  );
};

export default ConfirmRegistrationPage;
